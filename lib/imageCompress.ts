import imageCompression from 'browser-image-compression';

export interface CompressionResult {
    compressedFile: Blob;
    originalSizeKB: number;
    compressedSizeKB: number;
}

export async function compressImage(file: File): Promise<CompressionResult> {
    const originalSizeKB = file.size / 1024;

    // 1. Guard: If already <= 100KB, return as is (but ensure it's a blob/file we can use)
    if (originalSizeKB <= 100) {
        return {
            compressedFile: file,
            originalSizeKB: Number(originalSizeKB.toFixed(2)),
            compressedSizeKB: Number(originalSizeKB.toFixed(2))
        };
    }

    // 2. Initial Options
    let currentQuality = 0.7;
    let currentMaxWidthOrHeight = 1600;

    let options = {
        maxSizeMB: 0.1, // 100KB
        maxWidthOrHeight: currentMaxWidthOrHeight,
        useWebWorker: true,
        fileType: 'image/jpeg',
        initialQuality: currentQuality,
    };

    try {
        let compressedFile = await imageCompression(file, options);

        // 3. Iterative Loop
        // We loop if size > 100KB (102400 bytes)
        // We reduce quality first, then dimensions if quality is too low.

        // Safety break to prevent infinite loops
        let attempts = 0;
        while (compressedFile.size > 100 * 1024 && attempts < 10) {
            attempts++;

            // Strategy: Reduce quality until 0.25, then reduce dimensions
            if (currentQuality > 0.25) {
                currentQuality = Math.max(0.25, currentQuality - 0.1);
            } else {
                // Quality is low, reduce dimensions
                // e.g. 1600 -> 1280 -> 1024 -> 800
                currentMaxWidthOrHeight = Math.floor(currentMaxWidthOrHeight * 0.8);
            }

            options = {
                ...options,
                initialQuality: currentQuality,
                maxWidthOrHeight: currentMaxWidthOrHeight
            };

            // Compress again with new options
            compressedFile = await imageCompression(file, options);
        }

        return {
            compressedFile,
            originalSizeKB: Number(originalSizeKB.toFixed(2)),
            compressedSizeKB: Number((compressedFile.size / 1024).toFixed(2))
        };

    } catch (error) {
        console.error('Image compression failed:', error);
        throw error;
    }
}
