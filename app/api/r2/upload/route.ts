import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

export const runtime = "nodejs";

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
    console.log('[R2-UPLOAD] Request received');

    try {
        // 1. Parse multipart form data
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const siteId = formData.get('siteId') as string | null;
        const rowId = formData.get('rowId') as string | null;
        const kind = formData.get('kind') as string | null;

        console.log('[R2-UPLOAD] Parsed form data:', {
            hasFile: !!file,
            fileSize: file?.size,
            fileType: file?.type,
            siteId,
            rowId,
            kind,
        });

        // 2. Validation
        if (!file || !(file instanceof File)) {
            console.error('[R2-UPLOAD] Validation failed: Missing or invalid file');
            return NextResponse.json({ error: 'Missing or invalid file' }, { status: 400 });
        }
        if (file.size === 0) {
            console.error('[R2-UPLOAD] Validation failed: Empty file');
            return NextResponse.json({ error: 'Empty file received' }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
            console.error('[R2-UPLOAD] Validation failed: File too large', file.size);
            return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 400 });
        }
        if (!siteId || typeof siteId !== 'string') {
            console.error('[R2-UPLOAD] Validation failed: Missing siteId');
            return NextResponse.json({ error: 'Missing or invalid siteId' }, { status: 400 });
        }
        if (!rowId || typeof rowId !== 'string') {
            console.error('[R2-UPLOAD] Validation failed: Missing rowId');
            return NextResponse.json({ error: 'Missing or invalid rowId' }, { status: 400 });
        }
        if (kind !== 'serial' && kind !== 'tag') {
            console.error('[R2-UPLOAD] Validation failed: Invalid kind', kind);
            return NextResponse.json({ error: 'Invalid kind. Must be "serial" or "tag"' }, { status: 400 });
        }

        // 3. Read Env Vars
        const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
        const R2_BUCKET = process.env.R2_BUCKET;
        const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
        const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_BASE_URL) {
            console.error('[R2-UPLOAD] Missing R2 environment variables');
            return NextResponse.json({ error: 'Server configuration error (R2)' }, { status: 500 });
        }

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            console.error('[R2-UPLOAD] Missing Supabase environment variables');
            return NextResponse.json({ error: 'Server configuration error (Supabase)' }, { status: 500 });
        }

        // 4. Create Safe Site ID & Object Key
        const safeSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const key = `sites/${safeSiteId}/${rowId}/${kind}.jpg`;
        console.log('[R2-UPLOAD] Generated key:', key);

        // 5. Determine Content-Type (fallback to image/jpeg if empty or not image)
        let contentType = file.type;
        if (!contentType || !contentType.startsWith('image/')) {
            contentType = 'image/jpeg';
        }
        console.log('[R2-UPLOAD] Content-Type:', contentType);

        // 6. Read file buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log('[R2-UPLOAD] Buffer size:', buffer.length);

        if (buffer.length === 0) {
            console.error('[R2-UPLOAD] Buffer is empty after reading file');
            return NextResponse.json({ error: 'Failed to read file content' }, { status: 400 });
        }

        // 7. Configure S3 Client for R2
        const client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
        });

        // 8. Upload to R2
        console.log('[R2-UPLOAD] Uploading to R2...');
        const command = new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            CacheControl: 'no-cache, no-store, must-revalidate',
        });

        await client.send(command);
        console.log('[R2-UPLOAD] R2 upload successful');

        // 9. Construct Public URL
        const baseUrl = R2_PUBLIC_BASE_URL.endsWith('/') ? R2_PUBLIC_BASE_URL.slice(0, -1) : R2_PUBLIC_BASE_URL;
        const publicUrl = `${baseUrl}/${key}`;
        console.log('[R2-UPLOAD] Public URL:', publicUrl);

        // 10. Update Supabase (server-side with service role)
        // Only update if rowId is a valid UUID (not NEW_TEMP_ID)
        if (rowId !== 'NEW_TEMP_ID') {
            console.log('[R2-UPLOAD] Updating Supabase for rowId:', rowId);
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
            const fieldName = kind === 'serial' ? 'serial_pic_url' : 'tag_pic_url';

            const { error: updateError } = await supabase
                .from('main_inventory')
                .update({
                    [fieldName]: publicUrl,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', rowId);

            if (updateError) {
                console.error('[R2-UPLOAD] Supabase update error:', updateError.message);
                // Don't fail the whole request - image is already uploaded
                // Return success but indicate DB update failed
                return NextResponse.json({
                    key,
                    publicUrl,
                    dbUpdated: false,
                    dbError: 'Failed to update database record',
                });
            }
            console.log('[R2-UPLOAD] Supabase update successful');
        }

        console.log('[R2-UPLOAD] Complete success');
        return NextResponse.json({
            key,
            publicUrl,
            dbUpdated: rowId !== 'NEW_TEMP_ID',
        });

    } catch (error) {
        console.error('[R2-UPLOAD] Unhandled error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

