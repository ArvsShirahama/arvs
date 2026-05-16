/**
 * Image processing utilities for background image upload
 * Handles validation, compression, and cropping
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_WIDTH = 1080;
export const MAX_HEIGHT = 1920;
export const COMPRESSION_QUALITY = 0.85;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Validate image file size and type
 */
export function validateImageFile(file: File | Blob): ValidationResult {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `Image must be less than 10MB. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
    };
  }

  // Check MIME type
  if (file instanceof File) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return {
        valid: false,
        error: 'Unsupported image format. Please use JPEG, PNG, or WebP.',
      };
    }
  }

  return { valid: true };
}

/**
 * Calculate new dimensions while maintaining aspect ratio
 */
function calculateResize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let newWidth = width;
  let newHeight = height;

  if (newWidth > maxWidth) {
    newHeight = (newHeight * maxWidth) / newWidth;
    newWidth = maxWidth;
  }

  if (newHeight > maxHeight) {
    newWidth = (newWidth * maxHeight) / newHeight;
    newHeight = maxHeight;
  }

  return { width: Math.round(newWidth), height: Math.round(newHeight) };
}

/**
 * Compress and resize image to maximum dimensions
 * Uses Canvas API for client-side processing
 */
export async function compressAndResizeImage(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      // Clean up object URL
      URL.revokeObjectURL(img.src);

      // Calculate new dimensions maintaining aspect ratio
      const { width, height } = calculateResize(img.width, img.height, MAX_WIDTH, MAX_HEIGHT);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Draw image with smoothing for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob with compression
      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob) {
            resolve(compressedBlob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        COMPRESSION_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Get cropped image from react-easy-crop coordinates
 * Extracts the selected region using Canvas API
 */
export async function getCroppedImage(
  imageSrc: string,
  crop: Crop
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  canvas.width = crop.width;
  canvas.height = crop.height;

  // Draw cropped region
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to crop image'));
        }
      },
      'image/jpeg',
      COMPRESSION_QUALITY
    );
  });
}

/**
 * Helper to load image from URL
 */
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', (error) => reject(error));
    img.src = url;
  });
}
