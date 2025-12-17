
import cv2
import numpy as np
import os

def clean_image(path):
    print(f"Processing {path}...")
    # Load image (assuming it might be RGBA or RGB)
    # The user images are likely screenshots -> RGB or RGBA with white/dark bg.
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    
    if img is None:
        print("Failed to load.")
        return

    # Handle Alpha channel if exists
    if img.shape[2] == 4:
        # If transparent, extract alpha
        alpha = img[:, :, 3]
        # Make base BGR
        base = img[:, :, :3]
        # If alpha is 0, it's background.
    else:
        base = img
    
    # Convert to grayscale
    gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    
    # Threshold. Assuming Black Lines on White/Light BG.
    # Invert so lines are White (255) and BG is Black (0) for contour detection
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        print("No contours found.")
        return

    # Assuming the BOX is the largest outer contour, OR the hand is inside.
    # Let's sort by area.
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    
    # The largest contour is likely the Box frame if it exists.
    # The hand should be inside or the second largest?
    # Actually, if the box is connected (solid square), it's one contour.
    # If the hand is "inside" the box but not touching it, it's a child contour? 
    # But RETR_EXTERNAL only retrieves outer ones.
    # If the hand is inside the box, RETR_EXTERNAL only sees the box!
    
    # Let's try RETR_TREE
    contours_tree, hierarchy = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    # If we have a box connected to nothing, it is a contour.
    # If we have a hand inside, it is a separate contour (if not touching).
    
    # Strategy: 
    # 1. Create a mask of Everything.
    # 2. Identify the "Border" contour. It usually touches the edges or has a very large bounding box.
    # 3. Remove that contour.
    
    mask = np.zeros_like(gray)
    
    # Let's look at the top contours by area
    # Usually the Hand is large, the Box is larger.
    
    found_box = False
    
    # New approach:
    # Just grab the Center content?
    # Or, identify the Box by shape (approxPolyDP -> 4 corners).
    
    keep_contours = []
    
    for cnt in contours_tree:
        area = cv2.contourArea(cnt)
        if area < 100: continue # noise
        
        x,y,w,h = cv2.boundingRect(cnt)
        aspect_ratio = float(w)/h
        extent = float(area)/(w*h)
        
        # A box frame is usually a thin loop. 
        # A solid box?
        # The user image looked like a specific outline.
        
        # Let's assume the Hand is the "Compact" object in the center.
        # The Box is the "Large" object surrounding it.
        
        # Simple heuristic:
        # If a contour bounding rect touches the image edges (or is very close), it's likely the frame.
        h_img, w_img = img.shape[:2]
        margin = 5
        touches_edge = (x <= margin) or (y <= margin) or (x+w >= w_img-margin) or (y+h >= h_img-margin)
        
        # If it touches edge, ignore it (mask it out).
        # But wait, touching edge of *screenshot*? 
        
        # Let's just Mask the Center? No.
        
        # Let's try to remove the LARGEST contour if it looks like a box.
        # But RETR_TREE returns the hole inside the box as a contour too?
        
        pass

    # Alternative:
    # Use Connected Components with Stats.
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(thresh, connectivity=8)
    
    # Label 0 is background.
    # Iterate labels.
    # Find label with bounding box closest to image size = Frame?
    # Find label with bounding box centered but smaller = Hand?
    
    # We want to KEEP the Hand.
    # Hand is likely the Centermost object with significant area.
    
    img_center = np.array([img.shape[1]/2, img.shape[0]/2])
    
    best_label = -1
    min_dist = float('inf')
    
    # Create final mask
    final_output = np.zeros((img.shape[0], img.shape[1], 4), dtype=np.uint8)
    
    # We need to reconstruct the white lines.
    # Original image has Black lines on White BG.
    # thresh has White lines (255) on Black BG (0).
    
    # We want valid pixels to be White (255,255,255) with Alpha 255.
    # Anomalous pixels (BG) to be Alpha 0.
    
    # Collecting valid labels
    valid_mask = np.zeros_like(gray)
    
    for i in range(1, num_labels):
        x, y, w, h, area = stats[i]
        
        # If area is too small, skip
        if area < 50: continue
        
        # Logic to detect Box:
        # If aspect ratio is ~1.0 AND area is large?
        # If it contains the center?
        
        # Let's assume the HAND is the object closest to the center that isn't the giant frame.
        # Check centroid distance to center
        cx, cy = centroids[i]
        dist = np.linalg.norm(np.array([cx, cy]) - img_center)
        
        # If area is very large > 90% of image, it's probably noise or frame?
        # Or if it's a hollow frame, area of pixels itself might be small (just the line).
        # Bounding box coverage is a better metric.
        bbox_area = w * h
        img_area = img.shape[0] * img.shape[1]
        coverage = bbox_area / img_area
        
        print(f"Label {i}: Area={area}, BBoxCover={coverage:.2f}, Dist={dist:.1f}")
        
        # If coverage > 0.8, it's likely the Frame (if the hand is inside).
        # But the hand is inside...
        
        # Wait, if `connectedComponents` runs on the inverted lines:
        # The Frame is one component (the square line).
        # The Hand is another component (the hand lines).
        # They should be DISCONNECTED if the hand is floating in the box.
        
        # If they are disconnected:
        # The Frame will have a Bounding Box that covers almost the whole image?
        # The Hand will have a smaller Bounding Box inside.
        
        if coverage > 0.5:
            # Likely the Box Frame
            print("Ignoring likely Frame.")
            continue
            
        # If we got here, it's likely a Hand part.
        # Add to mask.
        valid_mask[labels == i] = 255
        
    # Now valid_mask contains just the hand (hopefully).
    
    # Dilate slightly to close gaps? No, keep sharp.
    
    # Create RGBA
    # Set RGB to White (since we want white lines)
    # Set Alpha to valid_mask
    
    res = np.zeros((img.shape[0], img.shape[1], 4), dtype=np.uint8)
    res[:, :, 0] = 255
    res[:, :, 1] = 255
    res[:, :, 2] = 255
    res[:, :, 3] = valid_mask
    
    # Save
    out_path = path.replace('.png', '_clean.png')
    cv2.imwrite(out_path, res)
    print(f"Saved to {out_path}")

# Run
clean_image('hand-point.png')
clean_image('hand-pinch.png')
