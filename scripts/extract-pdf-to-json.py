#!/usr/bin/env python3
"""
Extract prompts and images from PDF and create JSON for gallery
"""

import json
import sys
import os

def extract_pdf_content(pdf_path):
    """Extract text and image information from PDF"""
    gallery_data = []
    
    try:
        import pdfplumber
        
        with pdfplumber.open(pdf_path) as pdf:
            print(f"📄 PDF has {len(pdf.pages)} pages")
            
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                print(f"\n📄 Page {page_num}:")
                print(f"Text length: {len(text) if text else 0}")
                
                if text:
                    # Try to identify prompts and images
                    lines = text.split('\n')
                    prompt = None
                    
                    # Look for prompt-like text (usually longer text blocks)
                    potential_prompts = [line.strip() for line in lines if len(line.strip()) > 50]
                    
                    if potential_prompts:
                        prompt = potential_prompts[0]  # Take the first long text as prompt
                        print(f"Found prompt: {prompt[:100]}...")
                    
                    # Extract images from page
                    images = page.images
                    print(f"Found {len(images)} images on page {page_num}")
                    
                    if images:
                        for img_idx, img in enumerate(images):
                            entry = {
                                "id": f"pdf-{page_num}-{img_idx + 1}",
                                "prompt": prompt or f"Image from PDF page {page_num}",
                                "imageUrl": "",  # Will need to be extracted or uploaded
                                "model": "Nano Banana Pro",
                                "aspectRatio": "16:9",
                                "author": "pdf_import"
                            }
                            gallery_data.append(entry)
                    elif prompt:
                        # If no images but has prompt, still add entry
                        entry = {
                            "id": f"pdf-{page_num}",
                            "prompt": prompt,
                            "imageUrl": "",  # Placeholder - user will need to add URL
                            "model": "Nano Banana Pro",
                            "aspectRatio": "16:9",
                            "author": "pdf_import"
                        }
                        gallery_data.append(entry)
                        
    except ImportError:
        try:
            import PyPDF2
            
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                print(f"📄 PDF has {len(pdf_reader.pages)} pages")
                
                for page_num, page in enumerate(pdf_reader.pages, 1):
                    text = page.extract_text()
                    print(f"\n📄 Page {page_num}:")
                    print(f"Text length: {len(text) if text else 0}")
                    
                    if text:
                        lines = text.split('\n')
                        potential_prompts = [line.strip() for line in lines if len(line.strip()) > 50]
                        
                        if potential_prompts:
                            prompt = potential_prompts[0]
                            print(f"Found prompt: {prompt[:100]}...")
                            
                            entry = {
                                "id": f"pdf-{page_num}",
                                "prompt": prompt,
                                "imageUrl": "",  # Placeholder
                                "model": "Nano Banana Pro",
                                "aspectRatio": "16:9",
                                "author": "pdf_import"
                            }
                            gallery_data.append(entry)
                            
        except ImportError:
            print("❌ Error: Need pdfplumber or PyPDF2 installed")
            print("Install with: pip install pdfplumber")
            return []
    
    return gallery_data

if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "klint_image.pdf"
    
    if not os.path.exists(pdf_path):
        print(f"❌ PDF file not found: {pdf_path}")
        sys.exit(1)
    
    print(f"🔍 Extracting data from: {pdf_path}")
    data = extract_pdf_content(pdf_path)
    
    if data:
        output_path = "public/data/klint-community-gallery.json"
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\n✅ Extracted {len(data)} entries")
        print(f"📝 Saved to: {output_path}")
        print("\n⚠️  Note: imageUrl fields are empty - you'll need to:")
        print("   1. Extract images from PDF manually, or")
        print("   2. Upload images to a hosting service and add URLs")
    else:
        print("❌ No data extracted from PDF")

