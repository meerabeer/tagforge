import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { siteId, rowId, kind, contentType } = body;

        // 1. Validation
        if (!siteId || typeof siteId !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid siteId' }, { status: 400 });
        }
        if (!rowId || typeof rowId !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid rowId' }, { status: 400 });
        }
        if (kind !== 'serial' && kind !== 'tag') {
            return NextResponse.json({ error: 'Invalid kind. Must be "serial" or "tag"' }, { status: 400 });
        }
        if (!contentType || typeof contentType !== 'string' || !contentType.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid contentType. Must start with "image/"' }, { status: 400 });
        }

        // 2. Read Env Vars
        const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
        const R2_BUCKET = process.env.R2_BUCKET;
        const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
        const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;

        if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_BASE_URL) {
            console.error('Missing R2 environment variables');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // 3. Create Safe Site ID & Object Key
        const safeSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const key = `sites/${safeSiteId}/${rowId}/${kind}.jpg`;

        // 4. Configure S3 Client for R2
        const client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
        });

        // 5. Generate Presigned URL
        const command = new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            ContentType: contentType,
        });

        // Expires in 5 minutes (300 seconds)
        const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });

        // 6. Construct Public URL
        // Ensure no double slashes
        const baseUrl = R2_PUBLIC_BASE_URL.endsWith('/') ? R2_PUBLIC_BASE_URL.slice(0, -1) : R2_PUBLIC_BASE_URL;
        const publicUrl = `${baseUrl}/${key}`;

        return NextResponse.json({
            key,
            uploadUrl,
            publicUrl,
        });

    } catch (error) {
        console.error('Error generating presigned URL:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
