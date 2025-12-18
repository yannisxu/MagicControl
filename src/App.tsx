import React, { useEffect, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type Mode = 'off' | 'laser'
type GestureType = 'none' | 'fist' | 'open' | 'pinch'

const LERP = 0.2
const MAX_TRAIL = 12

// Helper: Euclidean distance
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// History Queue for Swipe Detection - REMOVED
// const MAX_HISTORY = 10;
// const SWIPE_THRESHOLD = 0.25; 
// const SWIPE_COOLDOWN = 800; 

function isFingerFolded(lm: any[], tipIdx: number, pipIdx: number) {
  const wrist = lm[0]
  const tip = lm[tipIdx]
  const pip = lm[pipIdx]
  return dist(tip, wrist) < dist(pip, wrist)
}



// Detection: Pointing (Index extended, others folded)
function isPointing(lm: any[]): boolean {
  const indexExtended = !isFingerFolded(lm, 8, 6)
  const middleFolded = isFingerFolded(lm, 12, 10)
  const ringFolded = isFingerFolded(lm, 16, 14)
  const pinkyFolded = isFingerFolded(lm, 20, 18)
  return indexExtended && middleFolded && ringFolded && pinkyFolded
}

// Detection: Pinch (Index and Thumb close together)
function isPinch(lm: any[], current: boolean): boolean {
  const thumbTip = lm[4]
  const indexTip = lm[8]
  const distance = dist(thumbTip, indexTip)

  // Hysteresis:
  // Enter (Start Pinch) if < 0.035
  // Exit (Stop Pinch) if > 0.08 (Relaxed to prevent drops)
  if (current) {
    return distance < 0.08
  } else {
    return distance < 0.035
  }
}

// Action: Send simulated key press
async function sendKey(direction: 'right' | 'left') {
  try {
    console.log(`Sending key: ${direction}`)
    await invoke('press_key', { direction })
  } catch (e) {
    console.error(e)
  }
}

function fullscreenFixedStyle(): React.CSSProperties {
  return { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }
}

export default function App() {
  console.log("App Version: TAURI_2_" + Date.now());

  const [mode, setMode] = useState<Mode>('laser')
  const cursorRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) // Smooth Render Coordinates
  const targetRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) // Latest Raw Camera Coordinates
  const [hasHand, setHasHand] = useState(false)

  // Gesture State
  const [gesture, setGesture] = useState<GestureType>('none')
  const [progress, setProgress] = useState(0) // 0 - 1
  const [toast, setToast] = useState<string | null>(null)
  const [err, setErr] = useState<string>('')


  // Settings - 可调配置
  const [pointerSize, setPointerSize] = useState(5) // Default small
  // const [holdDuration, setHoldDuration] = useState(1500) // REMOVED

  // Visual Feedback Settings
  const [showPinch, setShowPinch] = useState(true)
  const [showToastState, setShowToastState] = useState(true)

  // const holdDurationRef = useRef(holdDuration) // REMOVED
  const showPinchRef = useRef(showPinch)
  const showToastRef = useRef(showToastState)

  // useEffect(() => { holdDurationRef.current = holdDuration }, [holdDuration]) // REMOVED
  useEffect(() => { showPinchRef.current = showPinch }, [showPinch])
  useEffect(() => { showToastRef.current = showToastState }, [showToastState])

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<Array<{ x: number; y: number }>>([])

  // Gesture Refs
  // const gestureHistoryRef = useRef<number[]>([]) // Store Y coords - REMOVED
  // const lastSwipeTimeRef = useRef<number>(0) // REMOVED


  const currentGestureRef = useRef<GestureType>('none')
  const modeRef = useRef<Mode>(mode)

  // Drag State for Pinch Gesture
  const dragOriginRef = useRef<{ x: number, y: number } | null>(null)
  const dragCurrentRef = useRef<{ x: number, y: number } | null>(null)
  const pinchLossFrameCountRef = useRef(0) // Debounce counter
  const DRAG_THRESHOLD = 0.12 // 15% -> 12% trigger (easier to swipe)

  // Wave Gesture State for Dismissing Laser
  const waveCountRef = useRef(0) // Number of wave motions detected
  const lastWaveDirectionRef = useRef<'left' | 'right' | null>(null) // Last wave direction
  const waveStartTimeRef = useRef<number>(0) // Start time of wave sequence
  const lastWaveXRef = useRef<number | null>(null) // Last X coordinate
  const WAVE_THRESHOLD = 0.08 // Min X movement to count as wave (8% of screen)
  const WAVE_COUNT_REQUIRED = 4 // Number of waves needed to dismiss
  const WAVE_TIME_WINDOW = 2000 // Time window in ms to complete waves

  useEffect(() => { modeRef.current = mode }, [mode])

  // Click-through behavior
  useEffect(() => {
    console.log("Setting click-through to TRUE");
    invoke('set_click_through', { ignore: true }).catch(console.error)
  }, [])

  // Listen for tray menu events
  useEffect(() => {
    const unlistenMode = listen<string>('set_mode', (event) => {
      console.log('Mode changed from tray:', event.payload);
      setMode(event.payload as Mode);
      showToast(`模式: ${event.payload === 'laser' ? '激光笔' : '隐身'}`);
    });

    // const unlistenSensitivity = listen<number>('set_sensitivity', (event) => {
    //   console.log('Sensitivity changed from tray:', event.payload);
    //   setPinchThreshold(event.payload);
    //   showToast(`灵敏度: ${event.payload < 0.05 ? '低' : event.payload > 0.08 ? '高' : '中'}`);
    // });

    // const unlistenHold = listen<number>('set_hold_duration', (event) => { }); // REMOVED

    const unlistenSize = listen<number>('set_pointer_size', (event) => {
      console.log('Pointer size changed from tray:', event.payload);
      setPointerSize(event.payload);
      showToast(`光标大小: ${event.payload}px`);
    });

    const unlistenDot = listen<boolean>('set_feedback_dot', (event) => {
      console.log('Feedback dot changed from tray:', event.payload);
      setShowPinch(event.payload);
      showToast(`捏合绿点: ${event.payload ? '开启' : '关闭'}`);
    });

    const unlistenToast = listen<boolean>('set_feedback_toast', (event) => {
      console.log('Feedback toast changed from tray:', event.payload);
      setShowToastState(event.payload);
      // Create a temporary toast to confirm setting change even if disabled globally for actions
      setToast(`操作文字: ${event.payload ? '开启' : '关闭'}`);
      setTimeout(() => setToast(null), 2000);
    });

    return () => {
      unlistenMode.then(fn => fn());
      // unlistenSensitivity.then(fn => fn()); // Removed pinch sensitivity
      // unlistenHold.then(fn => fn());
      unlistenSize.then(fn => fn());
      unlistenDot.then(fn => fn());
      unlistenToast.then(fn => fn());
    };
  }, []);

  // Show Toast helper
  const showToast = (msg: string) => {
    // Only show if enabled, OR if it's a system setting confirmation (which we force show above)
    // Actually, distinct between action toasts and system toasts. 
    // For simplicity, let's use the ref check here.
    // If the user turned OFF toast, they shouldn't see "Next Page", but they SHOULD see "Mode: Laser".
    // We will apply the filter AT THE CALL SITE for actions.
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  // Camera & MediaPipe Setup
  useEffect(() => {
    const videoEl = document.createElement('video')
    // videoEl.style.display = 'none' // REMOVED: display: none stops requestVideoFrameCallback
    // videoEl.style.display = 'none' // REMOVED
    videoEl.style.position = 'fixed'
    videoEl.style.top = '0'
    videoEl.style.left = '0'
    videoEl.style.width = '640px' // Restore size
    videoEl.style.height = '480px' // Restore size
    videoEl.style.opacity = '0.01' // Keep invisible but rendered
    videoEl.style.zIndex = '-9999'
    videoEl.style.pointerEvents = 'none'
    videoEl.autoplay = true
    videoEl.playsInline = true
    videoEl.autoplay = true
    videoEl.playsInline = true
    document.body.appendChild(videoEl)

    const offscreenCanvas = document.createElement('canvas')
    offscreenCanvas.width = 640
    offscreenCanvas.height = 480
    const offscreenCtx = offscreenCanvas.getContext('2d')

    const initHands = () => {
      console.log("[DEBUG] Checking MediaPipe Hands library...");
      invoke('update_tray_status', { status: '1. 检查 Hands 库...' }).catch(() => { });
      if (!(window as any).Hands) {
        setErr("MediaPipe Hands library not loaded")
        invoke('update_tray_status', { status: '❌ Hands 库未加载' }).catch(() => { });
        return
      }
      console.log("[DEBUG] MediaPipe Hands library found");
      invoke('update_tray_status', { status: '2. 创建 Hands 实例...' }).catch(() => { });

      // @ts-ignore
      const hands = new window.Hands({
        locateFile: (file: string) => {
          console.log("[DEBUG] MediaPipe loading file:", file);
          return `/mediapipe/hands/${file}`;
        },
      })
      console.log("[DEBUG] Hands instance created");
      invoke('update_tray_status', { status: '3. 配置 Hands...' }).catch(() => { });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      console.log("[DEBUG] Hands options set");

      hands.onResults((results: any) => {


        if (results.multiHandLandmarks?.length) {
          setHasHand(true)
          invoke('update_tray_status', { status: '✅ 手势检测中' }).catch(() => { });
          const lm = results.multiHandLandmarks[0]
          const tip = lm[8]
          const target = {
            x: (1 - tip.x) * window.innerWidth,
            y: tip.y * window.innerHeight,
          }

          // --- New Gesture Logic (Camera Loop - Logic Check Only) ---

          // 1. Pinch & Drag Logic
          // Check pinch with hysteresis based on current state
          const rawIsPinching = isPinch(lm, currentGestureRef.current === 'pinch');
          let effectiveIsPinching = rawIsPinching;

          if (currentGestureRef.current === 'pinch') {
            if (!rawIsPinching) {
              // Lost pinch? Check debounce
              pinchLossFrameCountRef.current++;
              if (pinchLossFrameCountRef.current < 5) { // 5 frames ~80ms grace period
                effectiveIsPinching = true; // Pretend we are still pinching
              }
            } else {
              pinchLossFrameCountRef.current = 0; // Reset
            }
          } else {
            if (rawIsPinching) {
              pinchLossFrameCountRef.current = 0;
            }
          }

          if (effectiveIsPinching) {
            // Keep targetRef updated with pinch center
            const p1 = lm[4]; // Thumb
            const p2 = lm[8]; // Index

            // Note: We use the stored offset derived from Index Tip usually, but applying it to Pinch Center is consistent.
            const rawCenterY = (p1.y + p2.y) / 2;

            const pinchCenter = {
              x: (1 - (p1.x + p2.x) / 2) * window.innerWidth, // Mirror
              y: rawCenterY * window.innerHeight
            };

            // Update Target (Logic Loop)
            targetRef.current = pinchCenter;

            // Start Drag
            if (!dragOriginRef.current) {
              dragOriginRef.current = pinchCenter;
            }
            dragCurrentRef.current = pinchCenter;
            currentGestureRef.current = 'pinch';
          }
          else {
            // Pinch Released Logic
            if (dragOriginRef.current && dragCurrentRef.current) {
              const dx = dragCurrentRef.current.x - dragOriginRef.current.x;
              const dy = dragCurrentRef.current.y - dragOriginRef.current.y;
              const screenW = window.innerWidth;
              const threshold = screenW * DRAG_THRESHOLD;

              // Logic: Right or Down -> Next
              // Logic: Left or Up -> Prev
              // (User request: "pinch & slide right OR down to flip")

              if (dx > threshold || dy > threshold) {
                sendKey('right');
                if (showToastRef.current) showToast('下一页');
              } else if (dx < -threshold || dy < -threshold) {
                sendKey('left');
                if (showToastRef.current) showToast('上一页');
              }
            }

            // Reset Drag
            dragOriginRef.current = null;
            dragCurrentRef.current = null;

            // 2. Pointing
            if (isPointing(lm)) {
              targetRef.current = target; // Use Index Tip
              currentGestureRef.current = 'none'; // Render as laser
              setProgress(0);
              // Reset wave detection when pointing
              waveCountRef.current = 0;
              lastWaveDirectionRef.current = null;
              lastWaveXRef.current = null;
            }
            else {
              // Open hand / Hover - Check for Wave Gesture
              targetRef.current = target;
              currentGestureRef.current = 'open';
              setProgress(0);

              // Wave Detection Logic (only in laser mode)
              if (modeRef.current === 'laser') {
                const currentX = tip.x; // Normalized 0-1
                const now = Date.now();

                if (lastWaveXRef.current !== null) {
                  const deltaX = currentX - lastWaveXRef.current;
                  const absMove = Math.abs(deltaX);

                  // Detect direction change
                  if (absMove > WAVE_THRESHOLD) {
                    const currentDirection: 'left' | 'right' = deltaX > 0 ? 'left' : 'right'; // Mirrored

                    if (lastWaveDirectionRef.current !== null && currentDirection !== lastWaveDirectionRef.current) {
                      // Direction changed - count as a wave
                      if (waveCountRef.current === 0) {
                        waveStartTimeRef.current = now;
                      }
                      waveCountRef.current++;
                      console.log(`Wave detected: ${waveCountRef.current}/${WAVE_COUNT_REQUIRED}`);

                      // Check if enough waves in time window
                      if (waveCountRef.current >= WAVE_COUNT_REQUIRED) {
                        if (now - waveStartTimeRef.current <= WAVE_TIME_WINDOW) {
                          // Exit application
                          console.log('Wave gesture completed! Exiting application.');
                          if (showToastRef.current) showToast('再见！');
                          // Give user time to see the toast before exiting
                          setTimeout(() => {
                            invoke('exit_app').catch(console.error);
                          }, 500);
                        }
                        // Reset wave state
                        waveCountRef.current = 0;
                        lastWaveDirectionRef.current = null;
                        waveStartTimeRef.current = 0;
                      }
                    }
                    lastWaveDirectionRef.current = currentDirection;
                    lastWaveXRef.current = currentX;
                  }
                } else {
                  lastWaveXRef.current = currentX;
                }

                // Reset if time window exceeded
                if (waveCountRef.current > 0 && now - waveStartTimeRef.current > WAVE_TIME_WINDOW) {
                  waveCountRef.current = 0;
                  lastWaveDirectionRef.current = null;
                  waveStartTimeRef.current = 0;
                }
              }
            }
          }

          setGesture(currentGestureRef.current)

        } else {
          setHasHand(false)
          // Reset Drag if hand lost
          dragOriginRef.current = null;
          dragCurrentRef.current = null;
          pinchLossFrameCountRef.current = 0;
          invoke('update_tray_status', { status: '⚪ 未检测到手势' }).catch(() => { });
          currentGestureRef.current = 'none'
          setProgress(0)
        }
      })

      // Camera Utility REMOVED
      // Replaced by custom requestAnimationFrame loop below

      // Check for secure context and getUserMedia availability
      console.log("Secure Context:", window.isSecureContext);
      console.log("navigator.mediaDevices:", navigator.mediaDevices);
      console.log("getUserMedia:", navigator.mediaDevices?.getUserMedia);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = `Camera API Missing. SecureContext: ${window.isSecureContext}`;
        console.error(msg);
        setErr(msg);

        invoke('update_tray_status', { status: '❌ Camera API 缺失' }).catch(() => { });
        return;
      }


      invoke('update_tray_status', { status: '4. 请求摄像头权限...' }).catch(() => { });

      let rafId: number;
      let frameCount = 0;
      let running = true;

      const processFrame = async () => {
        if (!running) return;

        if (videoEl.readyState >= 2 && !videoEl.paused && !videoEl.ended) {
          frameCount++;
          if (frameCount % 60 === 0) {
            console.log("[DEBUG] Frame loop alive:", frameCount);
            invoke('update_tray_status', { status: `⚡ 运行中 (${frameCount})` }).catch(() => { });
          }

          try {
            if (offscreenCtx) {
              offscreenCtx.drawImage(videoEl, 0, 0, 640, 480);
              // Wait for send to complete
              await hands.send({ image: offscreenCanvas });
            }
          } catch (e: any) {
            const msg = e.message || String(e);
            console.error("[DEBUG] hands.send error:", msg);
            // Rate limit error toasts/updates
            if (frameCount % 30 === 0) {
              invoke('update_tray_status', { status: `❌ Err: ${msg.substring(0, 15)}` }).catch(() => { });
            }
          }
        }

        rafId = requestAnimationFrame(processFrame);
      };

      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then((stream: MediaStream) => {
          console.log("Camera stream obtained:", stream);
          setErr("");


          videoEl.srcObject = stream;
          videoEl.onloadedmetadata = () => {
            console.log("[DEBUG] video metadata loaded, starting camera...");
            invoke('update_tray_status', { status: '5. 启动摄像头...' }).catch(() => { });

            videoEl.play()
              .then(() => {
                console.log("[DEBUG] video playing");
                invoke('update_tray_status', { status: '6. 启动 Loop' }).catch(() => { });
                processFrame(); // Start the loop
              })
              .catch((e) => {
                console.error("[DEBUG] video.play() failed:", e);
                setErr("Video Play Error: " + e.message);
              });
          };
        })
        .catch((e: Error) => {
          console.error("Camera access denied or failed:", e);
          setErr(`Camera Error: ${e.name}: ${e.message}`);

          invoke('update_tray_status', { status: `❌ 摄像头错误: ${e.name}` }).catch(() => { });
        });

      return () => {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (videoEl.srcObject) {
          (videoEl.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        }
        hands.close()
      }
    }
    const cleanup = initHands()
    return () => { if (cleanup) cleanup(); videoEl.remove() }
  }, [])

  // Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    let raf = 0
    const render = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // --- SMOOTHING (Interpolate Cursor -> Target) ---
      // This happens at 60/120Hz, independent of Camera (30Hz)
      const prev = cursorRef.current;
      const target = targetRef.current;

      // Calculate smooth persistence
      // Using a frame-rate independent lerp would be better, but simple lerp works if FPS is stable
      const smoothFactor = currentGestureRef.current === 'pinch' ? 0.4 : LERP; // Faster track when pinching

      cursorRef.current = {
        x: prev.x + (target.x - prev.x) * smoothFactor,
        y: prev.y + (target.y - prev.y) * smoothFactor
      };

      const cursor = cursorRef.current; // NOW head and tail share this same coordinate!

      if (hasHand) {


        if (currentGestureRef.current === 'pinch') {
          // Clear laser trail immediately so it doesn't linger
          trailRef.current = [];

          // --- PINCH FEEDBACK (Green Glow) ---
          if (showPinchRef.current) {
            // 1. Green Dot (Feedback)
            ctx.shadowColor = '#4ade80'
            ctx.shadowBlur = 20
            ctx.fillStyle = '#4ade80'
            ctx.beginPath()
            ctx.arc(cursor.x, cursor.y, pointerSize * 1.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.shadowBlur = 0

            // 2. Drag Line (Origin -> Current)
            if (dragOriginRef.current) {
              ctx.strokeStyle = '#4ade80'
              ctx.lineWidth = 2
              ctx.setLineDash([5, 5]) // Dashed line for "guide" feel
              ctx.beginPath()
              ctx.moveTo(dragOriginRef.current.x, dragOriginRef.current.y)
              ctx.lineTo(cursor.x, cursor.y)
              ctx.stroke()
              ctx.setLineDash([]) // Reset

              // Draw Origin Point for clarity
              ctx.fillStyle = 'rgba(74, 222, 128, 0.5)'
              ctx.beginPath()
              ctx.arc(dragOriginRef.current.x, dragOriginRef.current.y, pointerSize, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
        else if (mode === 'laser') {
          // --- LASER TRAIL ---
          // Update Trail History in RENDER LOOP for smoothness
          // We push the INTERPOLATED cursor, not the raw target, creating a perfect spline
          trailRef.current.push(cursor);
          if (trailRef.current.length > MAX_TRAIL) trailRef.current.shift();

          const trail = trailRef.current;

          if (trail.length > 1) {
            const points = trail.map(t => [t.x, t.y]);
            const stroke = getStroke(points, {
              size: pointerSize * 2,
              thinning: 0.7,
              smoothing: 0.5,
              streamline: 0.5,
              easing: (t) => t,
              start: {
                taper: (trail.length * 2), // Thin tail (start of stroke)
                easing: (t) => t,
              },
              end: {
                taper: 0, // Thick head (end of stroke)
                easing: (t) => t,
              },
            });

            ctx.fillStyle = 'rgba(255, 50, 50, 0.8)';
            ctx.beginPath();
            if (stroke.length > 0) {
              ctx.moveTo(stroke[0][0], stroke[0][1]);
              for (let i = 1; i < stroke.length; i++) {
                ctx.lineTo(stroke[i][0], stroke[i][1]);
              }
            }
            ctx.fill();
          }

          // Head (Red Dot)
          ctx.shadowColor = 'rgba(255,0,0,0.8)'
          ctx.shadowBlur = 15
          ctx.fillStyle = 'rgba(255,0,0,1)'
          ctx.beginPath()
          ctx.arc(cursor.x, cursor.y, pointerSize, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
        }
      }

      raf = requestAnimationFrame(render)
    } // Close render function
    render()
    return () => cancelAnimationFrame(raf)
  }, [mode, hasHand, pointerSize]) // Removed 'cursor' dependency for performance

  return (
    <div style={fullscreenFixedStyle()}>
      <canvas ref={canvasRef} style={fullscreenFixedStyle()} />

      {progress > 0 && (
        <div style={{
          position: 'fixed', bottom: 40, right: 40,
          width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="80" height="80" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.3)" strokeWidth="8" fill="none" />
            <circle cx="50" cy="50" r="40" stroke={gesture === 'fist' ? '#a855f7' : '#eab308'} strokeWidth="8" fill="none"
              strokeDasharray={251} strokeDashoffset={251 * (1 - progress)} strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', color: 'white', fontWeight: 'bold', fontSize: 12, textAlign: 'center' }}>
            {gesture === 'fist' ? 'SWITCH' : 'BACK'}
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', top: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 24px', borderRadius: 20,
          fontSize: 16, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {toast}
        </div>
      )}

      {/* 设置已移至 Mac 菜单栏托盘图标 */}

      {err && (
        <div style={{ position: 'fixed', bottom: 10, left: 10, background: 'red', color: 'white', padding: 5, fontSize: 10 }}>
          {err}
        </div>
      )}
    </div>
  )
}
