import { Router } from "express";
import prisma from "../lib/prisma.js";
import PDFDocument from "pdfkit";
import axios from "axios";
import sharp from "sharp";

const router = Router();

async function fetchAndCompressImage(url, width = 200) {
  try {
    const response = await axios.get(url, { 
      responseType: 'arraybuffer', 
      timeout: 5000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const compressed = await sharp(Buffer.from(response.data))
      .resize(width, width, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();
    return compressed;
  } catch {
    return null;
  }
}

router.get("/pdf", async (req, res, next) => {
  let doc = null;
  try {
    const products = await prisma.product.findMany({
      include: {
        images: true,
        options: { include: { values: true } },
        collections: true,
      },
      orderBy: { title: "asc" },
    });

    doc = new PDFDocument({ size: "A4", margins: { top: 30, bottom: 30, left: 20, right: 20 } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=product-catalog.pdf");
    doc.pipe(res);

    const pw = doc.page.width;
    const ph = doc.page.height;
    const margin = 20;
    const cw = pw - margin * 2;

    // Cover
    doc.rect(0, 0, pw, ph).fill("#1a1a2e");
    doc.fontSize(40).font("Helvetica-Bold").fillColor("#fff").text("URBANIC", 0, ph/2 - 60, { align: "center" });
    doc.fontSize(20).fillColor("#f0f0f0").text("PITARA", 0, ph/2 - 20, { align: "center" });
    doc.fontSize(12).fillColor("#aaa").text(`Product Catalog - ${products.length} Products`, 0, ph/2 + 20, { align: "center" });
    doc.fontSize(10).fillColor("#888").text(new Date().toLocaleDateString("en-IN"), 0, ph/2 + 40, { align: "center" });

    // Products - 2 columns, clean list layout
    const cols = 2;
    const colW = (cw - 15) / cols;
    let y = 50;
    let col = 0;

    doc.addPage();
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#1a1a2e").text("Products", margin, 20);
    doc.moveTo(margin, 40).lineTo(pw - margin, 40).strokeColor("#ddd").lineWidth(1).stroke();

    for (let i = 0; i < products.length; i++) {
      const p = products[i];

      if (y + 130 > ph - 40) {
        doc.addPage();
        y = 30;
        col = 0;
      }

      const x = margin + col * (colW + 15);

      // Image box
      const imgBoxSize = 80;
      doc.rect(x, y, imgBoxSize, imgBoxSize).fill("#f5f5f5").strokeColor("#eee").lineWidth(1).stroke();

      // Try load image
      if (p.images?.[0]?.url) {
        try {
          const imgBuf = await fetchAndCompressImage(p.images[0].url, 150);
          if (imgBuf) {
            doc.image(imgBuf, x + 2, y + 2, { width: imgBoxSize - 4, height: imgBoxSize - 4 });
          }
        } catch {}
      }

      // Text info - to the right of image
      const textX = x + imgBoxSize + 8;
      const textW = colW - imgBoxSize - 15;

      doc.fontSize(10).font("Helvetica-Bold").fillColor("#222");
      doc.text(p.title?.substring(0, 35) || "Untitled", textX, y, { width: textW });

      // Price - using product's minPriceAmount directly
      const minPrice = parseFloat(p.minPriceAmount) || 0;
      const maxPrice = parseFloat(p.maxPriceAmount) || 0;
      const comparePrice = parseFloat(p.compareMinAmount) || 0;

      if (minPrice > 0) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#e63946");
        doc.text(minPrice === maxPrice ? `₹${minPrice}` : `₹${minPrice} - ₹${maxPrice}`, textX, y + 26, { width: textW });

        // Compare price (MRP)
        if (comparePrice > minPrice) {
          doc.fontSize(9).fillColor("#888").text(`MRP: ₹${comparePrice}`, textX, y + 40, { width: textW });
        }
      }

      // Options
      if (p.options?.length) {
        const optText = p.options.map(o => `${o.name}: ${o.values.slice(0, 4).map(v => v.name).join(", ")}`).join(" | ");
        doc.fontSize(7).fillColor("#555").text(optText.substring(0, 60), textX, y + 52, { width: textW });
      }

      // Collections
      if (p.collections?.length) {
        doc.fontSize(7).fillColor("#888").text(`Collection: ${p.collections[0].title}`, textX, y + 64, { width: textW });
      }

      col++;
      if (col >= cols) {
        col = 0;
        y += imgBoxSize + 20;
      }
    }

    // Footer - price summary
    doc.addPage();
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#1a1a2e").text("Price Summary", margin, 20);
    doc.moveTo(margin, 40).lineTo(pw - margin, 40).strokeColor("#ddd").lineWidth(1).stroke();

    y = 60;
    const ranges = [
      ["Under ₹1000", p => { const x = parseFloat(p.minPriceAmount) || 0; return x > 0 && x < 1000; }],
      ["₹1000 - ₹2000", p => { const x = parseFloat(p.minPriceAmount) || 0; return x >= 1000 && x < 2000; }],
      ["₹2000 - ₹3000", p => { const x = parseFloat(p.minPriceAmount) || 0; return x >= 2000 && x < 3000; }],
      ["₹3000 - ₹5000", p => { const x = parseFloat(p.minPriceAmount) || 0; return x >= 3000 && x < 5000; }],
      ["Above ₹5000", p => { const x = parseFloat(p.minPriceAmount) || 0; return x >= 5000; }],
    ];

    doc.fontSize(11).font("Helvetica");
    for (const [label, fn] of ranges) {
      const count = products.filter(fn).length;
      doc.fillColor("#333").text(`${label}: ${count} products`, margin, y);
      y += 18;
    }

    doc.end();
  } catch (err) {
    console.error("PDF error:", err);
    if (!res.headersSent) next(err);
  }
});

export default router;