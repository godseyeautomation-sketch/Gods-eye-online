#!/usr/bin/env python3
"""
Extract images from PDF and update JSON with image paths
"""

import json
import sys
import os
from pathlib import Path

def extract_images_from_pdf(pdf_path, output_dir):
    """Extract images from PDF pages"""
    try:
        import pdfplumber
        from PIL import Image
        import io
        
        images_extracted = []
        
        with pdfplumber.open(pdf_path) as pdf:
            print(f"📄 Extracting images from {len(pdf.pages)} pages...")
            
            os.makedirs(output_dir, exist_ok=True)
            
            for page_num, page in enumerate(pdf.pages, 1):
                # Try to get images from the page
                try:
                    # pdfplumber doesn't directly extract images, so we'll use a workaround
                    # Convert page to image and save it
                    im = page.to_image(resolution=150)
                    if im:
                        img_path = os.path.join(output_dir, f"page_{page_num:03d}.png")
                        im.save(img_path)
                        images_extracted.append({
                            "page": page_num,
                            "path": f"/data/images/page_{page_num:03d}.png",
                            "local_path": img_path
                        })
                        print(f"✅ Page {page_num}: Extracted image")
                except Exception as e:
                    print(f"⚠️  Page {page_num}: Could not extract image - {e}")
        
        return images_extracted
        
    except ImportError:
        print("❌ Need pdfplumber and Pillow installed")
        print("Install with: pip install pdfplumber pillow")
        return []

def update_json_with_images(json_path, images_data):
    """Update JSON file with image URLs"""
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        
        # Match images to entries by page number
        for entry in data:
            entry_id = entry.get("id", "")
            if entry_id.startswith("pdf-"):
                # Extract page number from id (format: pdf-{page}-{img_idx})
                parts = entry_id.split("-")
                if len(parts) >= 2:
                    try:
                        page_num = int(parts[1])
                        # Find matching image
                        for img in images_data:
                            if img["page"] == page_num:
                                entry["imageUrl"] = img["path"]
                                break
                    except ValueError:
                        pass
        
        # Save updated JSON
        with open(json_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"✅ Updated JSON with image paths")
        return data
        
    except Exception as e:
        print(f"❌ Error updating JSON: {e}")
        return []

if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "klint_image.pdf"
    json_path = "public/data/klint-community-gallery.json"
    images_dir = "public/data/images"
    
    if not os.path.exists(pdf_path):
        print(f"❌ PDF file not found: {pdf_path}")
        sys.exit(1)
    
    print(f"🖼️  Extracting images from: {pdf_path}")
    images = extract_images_from_pdf(pdf_path, images_dir)
    
    if images:
        print(f"\n✅ Extracted {len(images)} images to {images_dir}")
        print(f"📝 Updating JSON: {json_path}")
        update_json_with_images(json_path, images)
    else:
        print("⚠️  No images extracted, but prompts are in JSON")

