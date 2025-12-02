import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImage(filePathOrString, options = {}) {
  return await cloudinary.uploader.upload(filePathOrString, {
    folder: options.folder || "urbanic",
    overwrite: true,
    resource_type: "image",
    ...options,
  });
}

/**
 * Delete an image from Cloudinary using its URL
 * @param {string} imageUrl - The full Cloudinary URL
 * @returns {Promise<void>}
 */
export async function deleteImage(imageUrl) {
  try {
    if (!imageUrl) {
      console.warn('No image URL provided for deletion');
      return;
    }

    console.log('🗑️ Attempting to delete from Cloudinary:', imageUrl);

    // Extract public_id from Cloudinary URL
    // URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{version}/{public_id}.{format}
    // Example: https://res.cloudinary.com/dvyoxfhrh/image/upload/v1701428944/urbanic/abc123.jpg
    
    const urlParts = imageUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    
    if (uploadIndex === -1) {
      console.warn('❌ Invalid Cloudinary URL (no upload segment):', imageUrl);
      return;
    }
    
    // Everything after 'upload/' is the path containing version and public_id
    const pathParts = urlParts.slice(uploadIndex + 1);
    
    // Remove version part (e.g., v1701428944) if present
    const filteredParts = pathParts.filter(part => !part.startsWith('v') || isNaN(part.substring(1)));
    
    // Join remaining parts
    let publicId = filteredParts.join('/');
    
    // Remove file extension
    publicId = publicId.substring(0, publicId.lastIndexOf('.'));
    
    if (!publicId || publicId.trim() === '') {
      console.warn('❌ Could not extract public_id from URL:', imageUrl);
      return;
    }
    
    console.log('📋 Extracted public_id:', publicId);
    
    // Delete from Cloudinary
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('✅ Deleted from Cloudinary successfully:', result);
    
  } catch (error) {
    console.error('❌ Error deleting from Cloudinary:', {
      message: error.message,
      url: imageUrl,
      error
    });
    // Don't throw - we don't want to fail the delete operation if Cloudinary fails
  }
}
