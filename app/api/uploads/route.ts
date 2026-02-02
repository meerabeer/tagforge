import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// Use service role key for elevated permissions (table truncation/insertion)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CSV column mapping (CSV header -> DB column) - case insensitive matching
const COLUMN_MAP: Record<string, string> = {
    'site_id': 'site_id',
    'site_ID': 'site_id',
    'Site_ID': 'site_id',
    'Site ID': 'site_id',
    'SiteID': 'site_id',
    'siteid': 'site_id',
    'region': 'region',
    'Region': 'region',
    'REGION': 'region',
    'technology': 'technology',
    'Technology': 'technology',
    'TECHNOLOGY': 'technology',
    'priority': 'priority',
    'Priority': 'priority',
    'PRIORITY': 'priority',
};

// Function to find DB column from header (case-insensitive, trim spaces)
function mapColumnName(header: string): string | null {
    const trimmed = header.trim();
    // Direct match
    if (COLUMN_MAP[trimmed]) return COLUMN_MAP[trimmed];
    // Case-insensitive match
    const lower = trimmed.toLowerCase();
    if (lower === 'site_id' || lower === 'siteid' || lower === 'site id') return 'site_id';
    if (lower === 'region') return 'region';
    if (lower === 'technology') return 'technology';
    if (lower === 'priority') return 'priority';
    return null;
}

// Required columns for validation
// Required columns for validation (only site_id is truly required)
const REQUIRED_COLUMNS = ['site_id'];

// Parse CSV text into array of objects
function parseCSV(csvText: string): Record<string, string>[] {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return [];

    // Parse header - handle quoted values
    const headers = parseCSVLine(lines[0]);
    
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;

        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
            const dbColumn = mapColumnName(header);
            if (dbColumn) {
                row[dbColumn] = values[index]?.trim() || '';
            }
        });
        
        // Only add row if it has at least a site_id
        if (row['site_id']) {
            rows.push(row);
        }
    }
    
    return rows;
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);
    
    return values;
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const isPreview = formData.get('preview') === 'true';
        
        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Check file type
        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        const isCSV = fileName.endsWith('.csv');
        
        if (!isCSV && !isExcel) {
            return NextResponse.json(
                { error: 'File must be a CSV or Excel file (.csv, .xlsx, .xls)' },
                { status: 400 }
            );
        }

        let rows: Record<string, string>[] = [];

        if (isExcel) {
            // Parse Excel file
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // Get first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Get the range to see how many rows exist
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            console.log('Excel sheet range:', worksheet['!ref'], 'Total rows in sheet:', range.e.r + 1);
            
            // Convert to JSON with header row - no row limit
            const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { 
                defval: '',
                raw: false // Convert all values to strings
            });
            
            console.log('Excel rows parsed:', jsonData.length);
            if (jsonData.length > 0) {
                console.log('Excel columns found:', Object.keys(jsonData[0]));
            }
            
            // Map columns using flexible matching
            const allMappedRows = jsonData.map(row => {
                const mappedRow: Record<string, string> = {};
                Object.keys(row).forEach(key => {
                    const dbColumn = mapColumnName(key);
                    if (dbColumn) {
                        mappedRow[dbColumn] = String(row[key] || '').trim();
                    }
                });
                return mappedRow;
            });
            
            // Filter to only rows with site_id
            rows = allMappedRows.filter(row => row['site_id']);
            
            console.log('Rows with site_id:', rows.length, 'Rows without site_id:', allMappedRows.length - rows.length);
        } else {
            // Parse CSV file
            const text = await file.text();
            rows = parseCSV(text);
        }

        if (rows.length === 0) {
            return NextResponse.json(
                { error: 'No valid data rows found in file. Make sure your file has a column named site_id (or Site_ID)' },
                { status: 400 }
            );
        }

        // Show what columns were mapped
        const firstRow = rows[0];
        const mappedColumns = Object.keys(firstRow);
        console.log('Mapped columns:', mappedColumns, 'First row:', firstRow);

        // If preview mode, return sample data
        if (isPreview) {
            return NextResponse.json({
                preview: true,
                totalRows: rows.length,
                sampleRows: rows.slice(0, 10),
                columns: mappedColumns,
                message: `Found ${rows.length} valid rows with site_id`
            });
        }

        // Full upload - delete existing data and insert new
        const { error: deleteError } = await supabaseAdmin
            .from('fo_database_and_technology_updates')
            .delete()
            .neq('id', 0); // Delete all rows

        if (deleteError) {
            console.error('Delete error:', deleteError);
            return NextResponse.json(
                { error: `Failed to clear existing data: ${deleteError.message}` },
                { status: 500 }
            );
        }

        // Insert in batches of 1000 (increased for large files)
        const BATCH_SIZE = 1000;
        let insertedCount = 0;
        const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
        
        console.log(`Starting insert: ${rows.length} rows in ${totalBatches} batches`);
        
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            
            const { error: insertError, data } = await supabaseAdmin
                .from('fo_database_and_technology_updates')
                .insert(batch)
                .select('id'); // Only select id to reduce response size

            if (insertError) {
                console.error(`Insert error at batch ${batchNum}:`, insertError);
                return NextResponse.json(
                    { error: `Failed to insert data at batch ${batchNum}: ${insertError.message}` },
                    { status: 500 }
                );
            }
            
            insertedCount += data?.length || batch.length;
            console.log(`Batch ${batchNum}/${totalBatches} inserted: ${data?.length || batch.length} rows`);
        }

        return NextResponse.json({
            success: true,
            message: `Successfully uploaded ${insertedCount} records`,
            rowCount: insertedCount
        });

    } catch (err) {
        console.error('Upload error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to process upload' },
            { status: 500 }
        );
    }
}

// GET endpoint to fetch current data
export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('fo_database_and_technology_updates')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            return NextResponse.json(
                { error: error.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ data, count: data?.length || 0 });
    } catch (err) {
        console.error('Fetch error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to fetch data' },
            { status: 500 }
        );
    }
}
