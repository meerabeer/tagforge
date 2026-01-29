import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role key for elevated permissions (table truncation/insertion)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CSV column mapping (CSV header -> DB column)
const COLUMN_MAP: Record<string, string> = {
    'Site_ID_1': 'Site_ID_1',
    'Site_ID': 'Site_ID',
    'City': 'City',
    'Plan_Qtr.': 'Plan_Qtr.',
    'Domain': 'Domain',
    'P_(FO)': 'P_(FO)',
    'Site_Type': 'Site_Type',
    'Planned_PMR_Date': 'Planned_PMR_Date',
    'Autual_PMR_Date': 'Autual_PMR_Date',
    'Status': 'Status',
    'FME Name': 'FME Name',
};

// Required columns for validation
const REQUIRED_COLUMNS = ['Site_ID_1', 'Site_ID', 'Autual_PMR_Date', 'FME Name'];

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
            const trimmedHeader = header.trim();
            if (COLUMN_MAP[trimmedHeader]) {
                row[COLUMN_MAP[trimmedHeader]] = values[index]?.trim() || '';
            }
        });
        
        // Only add row if it has at least a Site_ID
        if (row['Site_ID'] || row['Site_ID_1']) {
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
        
        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Check file type
        if (!file.name.endsWith('.csv')) {
            return NextResponse.json(
                { error: 'File must be a CSV' },
                { status: 400 }
            );
        }

        // Read file content
        const csvText = await file.text();
        
        // Parse CSV
        const rows = parseCSV(csvText);
        
        if (rows.length === 0) {
            return NextResponse.json(
                { error: 'CSV file is empty or has no valid data rows' },
                { status: 400 }
            );
        }

        // Validate required columns
        const firstRow = rows[0];
        const missingColumns = REQUIRED_COLUMNS.filter(col => !(col in firstRow));
        if (missingColumns.length > 0) {
            return NextResponse.json(
                { error: `Missing required columns: ${missingColumns.join(', ')}` },
                { status: 400 }
            );
        }

        // Check if this is a preview request
        const preview = formData.get('preview') === 'true';
        
        if (preview) {
            // Return preview data (first 10 rows)
            return NextResponse.json({
                preview: true,
                totalRows: rows.length,
                sampleRows: rows.slice(0, 10),
                columns: Object.keys(firstRow)
            });
        }

        // Full upload - truncate and insert
        console.log(`[PMR Upload] Starting upload of ${rows.length} rows...`);

        // Step 1: Delete all existing rows
        const { error: deleteError } = await supabaseAdmin
            .from('pmr_actual_2026')
            .delete()
            .neq('id', 0); // Delete all rows (id is never 0)

        if (deleteError) {
            console.error('[PMR Upload] Delete error:', deleteError);
            return NextResponse.json(
                { error: `Failed to clear table: ${deleteError.message}` },
                { status: 500 }
            );
        }

        // Step 2: Insert new rows in batches
        const BATCH_SIZE = 500;
        let insertedCount = 0;
        
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            
            const { error: insertError } = await supabaseAdmin
                .from('pmr_actual_2026')
                .insert(batch);

            if (insertError) {
                console.error(`[PMR Upload] Insert error at batch ${i}:`, insertError);
                return NextResponse.json(
                    { error: `Failed to insert rows at batch ${i}: ${insertError.message}` },
                    { status: 500 }
                );
            }
            
            insertedCount += batch.length;
            console.log(`[PMR Upload] Inserted ${insertedCount}/${rows.length} rows`);
        }

        console.log(`[PMR Upload] Successfully uploaded ${insertedCount} rows`);

        return NextResponse.json({
            success: true,
            message: `Successfully uploaded ${insertedCount} PMR records`,
            rowCount: insertedCount
        });

    } catch (err) {
        console.error('[PMR Upload] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
