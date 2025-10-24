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


