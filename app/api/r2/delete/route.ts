import { NextRequest, NextResponse } from 'next/server';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { rowId, kind } = body;

        // 1. Validation
        if (!rowId || typeof rowId !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid rowId' }, { status: 400 });
        }
        if (kind !== 'serial' && kind !== 'tag') {
            return NextResponse.json({ error: 'Invalid kind. Must be "serial" or "tag"' }, { status: 400 });
        }

        // 2. Read Env Vars
        const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
        const R2_BUCKET = process.env.R2_BUCKET;
        const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
        const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;

        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_BASE_URL) {
            console.error('Missing R2 environment variables');
            return NextResponse.json({ error: 'Server configuration error (R2)' }, { status: 500 });
        }

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            console.error('Missing Supabase environment variables');
            return NextResponse.json({ error: 'Server configuration error (Supabase)' }, { status: 500 });
        }

        // 3. Initialize Supabase Service Client
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 4. Fetch current URL from DB
        const fieldName = kind === 'serial' ? 'serial_pic_url' : 'tag_pic_url';

        const { data: row, error: fetchError } = await supabase
            .from('main_inventory')
            .select(fieldName)
            .eq('id', rowId)
            .single();

        if (fetchError || !row) {
            return NextResponse.json({ error: 'Row not found' }, { status: 404 });
        }

        const currentUrl = (row as any)[fieldName] as string | null;

        if (!currentUrl) {
            return NextResponse.json({ ok: true, message: "Nothing to delete (URL empty)" });
        }

        // 5. Extract Object Key from URL
        // URL format: `${R2_PUBLIC_BASE_URL}/sites/<safeSiteId>/<rowId>/<kind>.jpg`
        // We need to strip the base URL part.

        let keyToRemove = '';

        // Normalize base URL (remove trailing slash)
        const baseUrl = R2_PUBLIC_BASE_URL.endsWith('/') ? R2_PUBLIC_BASE_URL.slice(0, -1) : R2_PUBLIC_BASE_URL;

        if (currentUrl.startsWith(baseUrl)) {
            // Remove base URL and leading slash
            keyToRemove = currentUrl.replace(baseUrl, '');
            if (keyToRemove.startsWith('/')) keyToRemove = keyToRemove.substring(1);
        } else {
            // Fallback: try to parse path from URL if it doesn't match base (e.g. domain change)
            try {
                const urlObj = new URL(currentUrl);
                // Pathname usually starts with /, so remove it
                keyToRemove = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
            } catch (e) {
                console.warn('Could not parse URL:', currentUrl);
                // If we can't parse it, we can't delete from R2 safely. 
                // But we should still clear DB? 
                // Let's assume we can't delete R2 object but we will clear field.
            }
        }

        // 6. Delete from R2 (if we have a key)
        if (keyToRemove) {
            const client = new S3Client({
                region: 'auto',
                endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: R2_ACCESS_KEY_ID,
                    secretAccessKey: R2_SECRET_ACCESS_KEY,
                },
            });

            try {
                await client.send(new DeleteObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: keyToRemove,
                }));
            } catch (r2Error) {
                console.warn('R2 DeleteObject failed:', r2Error);
                // We proceed to clear DB anyway
            }
        }

        // 7. Update Supabase Row (Clear URL)
        const { error: updateError } = await supabase
            .from('main_inventory')
            .update({
                [fieldName]: null,
                updated_at: new Date().toISOString(),
                // optional: updated_by: 'system' or similar if needed, trigger handles it mostly
            })
            .eq('id', rowId);

        if (updateError) {
            throw updateError;
        }

        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error('Error in delete generic:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
