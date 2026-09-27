import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'node:fs';

async function testPdfGen() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();

  // Header background
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: rgb(0.12, 0.14, 0.20),
  });

  // Header Title
  page.drawText('MEGA CONTABILIDADE - RELATÓRIO GESTTA', {
    x: 35,
    y: height - 45,
    size: 16,
    font: fontBold,
    color: rgb(0.67, 0.54, 0.98), // purple
  });

  page.drawText('Dossiê da Tarefa Contábil Sincronizada com CRM & Google Drive', {
    x: 35,
    y: height - 62,
    size: 9,
    font: font,
    color: rgb(0.8, 0.8, 0.8),
  });

  const pdfBytes = await doc.save();
  fs.writeFileSync('scratch/test-output.pdf', Buffer.from(pdfBytes));
  console.log('PDF generated successfully, size:', pdfBytes.length, 'bytes');
}

testPdfGen().catch(console.error);
