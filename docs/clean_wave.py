
import cv2
import numpy as np

def clean_wave_image_white(path, out_path):
    """Clean hand wave image - remove background and make hand WHITE"""
    print(f"Processing {path}...")
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    
    if img is None:
        print("Failed to load.")
        return
    
    # Convert to BGRA if needed
    if img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    
    # The image has dark content on light gray background
    # Convert to grayscale
    gray = cv2.cvtColor(img[:,:,:3], cv2.COLOR_BGR2GRAY)
    
    # Threshold to find the dark elements (hand icon)
    # Dark pixels < 100 are content, light pixels > 200 are background
    _, content_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
    
    # Create output with transparency
    result = np.zeros((img.shape[0], img.shape[1], 4), dtype=np.uint8)
    
    # Set content color to WHITE (user requested)
    # Where mask is white (255), we have content
    result[:, :, 0] = 255  # B - white
    result[:, :, 1] = 255  # G - white  
    result[:, :, 2] = 255  # R - white
    result[:, :, 3] = content_mask  # Alpha from mask
    
    # Save
    cv2.imwrite(out_path, result)
    print(f"Saved WHITE version to {out_path}")

# Run on uploaded image - make it white
clean_wave_image_white('/Users/bytedance/.gemini/antigravity/brain/dab6bddf-2ccf-4844-8217-ba4129b945a4/uploaded_image_1766072098437.png', 
                       '/Users/bytedance/Documents/MagicControl/docs/hand-wave_clean.png')
