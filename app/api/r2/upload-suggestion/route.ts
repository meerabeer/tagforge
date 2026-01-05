import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const runtime = "nodejs";

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
    console.log('[R2-UPLOAD-SUGGESTION] Request received');

    try {
        // 1. Parse multipart form data
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const suggestionId = formData.get('suggestionId') as string | null;

        console.log('[R2-UPLOAD-SUGGESTION] Parsed form data:', {
            hasFile: !!file,
            fileSize: file?.size,
            fileType: file?.type,
            suggestionId,
        });

        // 2. Validation
        if (!file || !(file instanceof File)) {
            console.error('[R2-UPLOAD-SUGGESTION] Validation failed: Missing or invalid file');
            return NextResponse.json({ error: 'Missing or invalid file' }, { status: 400 });
        }
        if (file.size === 0) {
            console.error('[R2-UPLOAD-SUGGESTION] Validation failed: Empty file');
            return NextResponse.json({ error: 'Empty file received' }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
            console.error('[R2-UPLOAD-SUGGESTION] Validation failed: File too large', file.size);
            return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 400 });
        }
        if (!suggestionId || typeof suggestionId !== 'string') {
            console.error('[R2-UPLOAD-SUGGESTION] Validation failed: Missing suggestionId');
            return NextResponse.json({ error: 'Missing or invalid suggestionId' }, { status: 400 });
        }

        // 3. Read Env Vars
        const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
        const R2_BUCKET = process.env.R2_BUCKET;
        const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
        const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;

        if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_BASE_URL) {
            console.error('[R2-UPLOAD-SUGGESTION] Missing R2 environment variables');
            return NextResponse.json({ error: 'Server configuration error (R2)' }, { status: 500 });
        }

        // 4. Create Object Key
        const key = `suggestions/${suggestionId}/image.jpg`;
        console.log('[R2-UPLOAD-SUGGESTION] Generated key:', key);

        // 5. Determine Content-Type (fallback to image/jpeg if empty or not image)
        let contentType = file.type;
        if (!contentType || !contentType.startsWith('image/')) {
            contentType = 'image/jpeg';
        }
        console.log('[R2-UPLOAD-SUGGESTION] Content-Type:', contentType);

        // 6. Read file buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log('[R2-UPLOAD-SUGGESTION] Buffer size:', buffer.length);

        if (buffer.length === 0) {
            console.error('[R2-UPLOAD-SUGGESTION] Buffer is empty after reading file');
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
        console.log('[R2-UPLOAD-SUGGESTION] Uploading to R2...');
        const command = new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            CacheControl: 'no-cache, no-store, must-revalidate',
        });

        await client.send(command);
        console.log('[R2-UPLOAD-SUGGESTION] R2 upload successful');

        // 9. Construct Public URL
        const baseUrl = R2_PUBLIC_BASE_URL.endsWith('/') ? R2_PUBLIC_BASE_URL.slice(0, -1) : R2_PUBLIC_BASE_URL;
        const publicUrl = `${baseUrl}/${key}`;
        console.log('[R2-UPLOAD-SUGGESTION] Public URL:', publicUrl);

        console.log('[R2-UPLOAD-SUGGESTION] Complete success');
        return NextResponse.json({
            key,
            publicUrl,
        });

    } catch (error) {
        console.error('[R2-UPLOAD-SUGGESTION] Unhandled error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
