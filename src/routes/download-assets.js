import express from "express";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";
import { createCanvas } from "canvas";
import axios from "axios";

const router = express.Router();
const prisma = new PrismaClient();

// Helper to download image
async function downloadImage(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return response.data;
  } catch (error) {
    console.error(`Failed to download image: ${url}`, error.message);
    return null;
  }
}

// Helper to render text to PNG buffer
function renderTextToPng(textElement) {
  try {
    // Create canvas with some padding
    // Estimate size based on font size and text length
    // This is an approximation. Ideally we'd measure text first.
    const fontSize = textElement.fontSize || 20;
    const lineHeight = textElement.lineHeight || 1.2;
    // const fontFamily = textElement.fontFamily || "Arial"; // Fallback to system font
    const fontFamily = "Arial"; // Use standard font for server-side safety
    
    // We need a temporary canvas to measure text
    const tempCanvas = createCanvas(100, 100);
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.font = `${textElement.fontStyle || ""} ${fontSize}px ${fontFamily}`;
    
    const metrics = tempCtx.measureText(textElement.text);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = Math.ceil(fontSize * lineHeight * 1.5); // Add some vertical padding

    const canvas = createCanvas(textWidth + 20, textHeight + 20);
    const ctx = canvas.getContext("2d");

    // Clear background (transparent)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set text properties
    ctx.font = `${textElement.fontStyle || ""} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = textElement.fill || "#000000";
    ctx.textBaseline = "middle";
    
    // Draw text centered
    ctx.fillText(textElement.text, 10, canvas.height / 2);

    // Add border if exists
    if (textElement.strokeWidth > 0 && textElement.stroke) {
        ctx.lineWidth = textElement.strokeWidth;
        ctx.strokeStyle = textElement.stroke;
        ctx.strokeText(textElement.text, 10, canvas.height / 2);
    }

    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error("Failed to render text:", error);
    return null;
  }
}

router.get("/orders/:orderId/custom-product/:customProductId", async (req, res) => {
  const { orderId, customProductId } = req.params;

  try {
    // 1. Fetch Custom Product and Design
    const customProduct = await prisma.customProduct.findUnique({
      where: { id: customProductId },
      include: {
        design: true,
      },
    });

    if (!customProduct) {
      return res.status(404).json({ error: "Custom product not found" });
    }

    const zip = new JSZip();
    
    // Fix: Access 'json' field, not 'data'
    let designData = customProduct.design?.json || {}; 
    
    // Fix: Parse if it's a string (Prisma might store it as a stringified JSON if passed as string)
    if (typeof designData === 'string') {
        try {
            designData = JSON.parse(designData);
        } catch (e) {
            console.error("Failed to parse design JSON:", e);
            designData = {};
        }
    }
    
    // Add Design Data JSON
    zip.file("design-data.json", JSON.stringify(designData, null, 2));

    // 2. Add Snapshots (Front/Back Previews)
    if (customProduct.snapshots) {
        const snapshots = typeof customProduct.snapshots === 'string' 
            ? JSON.parse(customProduct.snapshots) 
            : customProduct.snapshots;
            
        for (const [side, url] of Object.entries(snapshots)) {
            if (url) {
                const buffer = await downloadImage(url);
                if (buffer) {
                    zip.file(`${side}-preview.png`, buffer);
                }
            }
        }
    }

    // 3. Process Design Elements
    // Assuming designData structure matches the frontend state:
    // { front: [elements], back: [elements], ... }
    
    const elementsBySide = designData.elementsBySide || designData; // Handle different potential structures

    if (elementsBySide) {
        const imagesFolder = zip.folder("images");
        const textFolder = zip.folder("text");
        
        let imgCount = 1;
        let textCount = 1;

        for (const [side, elements] of Object.entries(elementsBySide)) {
            if (!Array.isArray(elements)) continue;

            for (const el of elements) {
                if (el.type === "image" && el.src) {
                    // Download uploaded image
                    // Check if it's a data URL or remote URL
                    if (el.src.startsWith("http")) {
                        const buffer = await downloadImage(el.src);
                        if (buffer) {
                            // Try to get extension from URL or default to png
                            const ext = el.src.split('.').pop().split('?')[0] || 'png';
                            // Clean extension if it's too long
                            const cleanExt = ext.length > 4 ? 'png' : ext;
                            imagesFolder.file(`${side}-image-${imgCount}.${cleanExt}`, buffer);
                            imgCount++;
                        }
                    }
                } else if (el.type === "text") {
                    // Render text to PNG
                    const buffer = renderTextToPng(el);
                    if (buffer) {
                        textFolder.file(`${side}-text-${textCount}-${el.text.substring(0, 10).replace(/[^a-z0-9]/gi, '_')}.png`, buffer);
                        textCount++;
                    }
                }
            }
        }
    }

    // 4. Generate and Stream ZIP
    const content = await zip.generateAsync({ type: "nodebuffer" });

    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename=assets-${customProductId}.zip`);
    res.set("Content-Length", content.length);
    res.send(content);

  } catch (error) {
    console.error("Download assets error:", error);
    res.status(500).json({ error: "Failed to generate assets zip" });
  }
});

export default router;
