import React, { useRef, useState, useEffect } from 'react';

/**
 * High-fidelity 3D-styled SVG mascots inspired by modern 3D character art:
 * - 'solar': Aviator-capped 3D character riding a sleek rocket with a laptop (Image 2 style)
 * - 'cosmic': Lovable 3D fluffy yeti/monster waving hello with floating file cards (Image 1 style)
 *
 * Built with pure SVG gradients, specular highlights, and clay/fur shading.
 * 100% lightweight, zero raster images, hardware accelerated.
 * Automatically pauses keyframe animations when off-screen, when the tab is hidden,
 * or under prefers-reduced-motion.
 */
export function HeroMascot({ theme = 'solar', className = '' }) {
  const containerRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let isIntersecting = true;

    // Check prefers-reduced-motion
    let motionQuery = null;
    if (typeof window !== 'undefined' && window.matchMedia) {
      motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    }

    const updatePausedState = () => {
      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const prefersReduced = motionQuery ? motionQuery.matches : false;
      setIsPaused(isHidden || prefersReduced || !isIntersecting);
    };

    // 1. Tab visibility listener
    const handleVisibility = () => {
      updatePausedState();
    };

    // 2. Reduced motion listener
    const handleMotion = () => {
      updatePausedState();
    };

    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', handleMotion);
    }

    // 3. Intersection observer for off-screen pausing
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined' && containerRef.current) {
      observer = new IntersectionObserver(
        ([entry]) => {
          isIntersecting = Boolean(entry && entry.isIntersecting);
          updatePausedState();
        },
        { threshold: 0.05 }
      );
      observer.observe(containerRef.current);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    // Initial check
    updatePausedState();

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (motionQuery && motionQuery.removeEventListener) {
        motionQuery.removeEventListener('change', handleMotion);
      }
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  if (theme === 'cosmic') {
    return (
      <div
        ref={containerRef}
        className={`hero-mascot-container mascot-cosmic ${isPaused ? 'mascot-paused' : ''} ${className}`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 460 420"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="hero-mascot-svg"
        >
          <defs>
            {/* Ambient ground shadow */}
            <radialGradient id="cosmicGroundShadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0, 0, 0, 0.45)" />
              <stop offset="60%" stopColor="rgba(0, 0, 0, 0.18)" />
              <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
            </radialGradient>

            {/* Blue Fur Body Gradients */}
            <radialGradient id="furBodyGrad" cx="38%" cy="32%" r="65%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="25%" stopColor="#0284c7" />
              <stop offset="70%" stopColor="#0369a1" />
              <stop offset="100%" stopColor="#075985" />
            </radialGradient>

            {/* Arm Highlight */}
            <linearGradient id="furArmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#075985" />
            </linearGradient>

            {/* Pink Smile */}
            <linearGradient id="pinkSmileGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fb7185" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>

            {/* Floating File Capsule Gradients */}
            <linearGradient id="filePillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e0e7ff" />
            </linearGradient>
            <linearGradient id="glowRing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.2" />
            </linearGradient>

            {/* Soft filter for glow */}
            <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Ground Contact Shadow */}
          <ellipse cx="230" cy="385" rx="140" ry="24" fill="url(#cosmicGroundShadow)" />

          {/* Floating Constellation Data Nodes */}
          <g className="mascot-nodes" opacity="0.65">
            <line x1="80" y1="120" x2="150" y2="170" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="150" y1="170" x2="100" y2="260" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="330" y1="110" x2="380" y2="170" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx="80" cy="120" r="4" fill="#ffffff" />
            <circle cx="100" cy="260" r="3.5" fill="#38bdf8" />
            <circle cx="380" cy="170" r="4.5" fill="#f472b6" />
          </g>

          {/* Animated Mascot Group */}
          <g className="mascot-figure">
            {/* Feet / Stumpy Legs */}
            <rect x="180" y="340" width="36" height="38" rx="16" fill="#075985" />
            <rect x="244" y="340" width="36" height="38" rx="16" fill="#075985" />
            <ellipse cx="198" cy="372" rx="20" ry="10" fill="#0369a1" />
            <ellipse cx="262" cy="372" rx="20" ry="10" fill="#0369a1" />

            {/* Left Hand / Resting Arm */}
            <path
              d="M 148 240 C 132 250, 126 276, 134 296 C 140 310, 155 316, 168 310 C 176 306, 178 290, 172 270 Z"
              fill="url(#furArmGrad)"
            />

            {/* Main Chubby Fur Body */}
            <path
              d="M 230 110
                 C 300 110, 325 155, 328 220
                 C 330 280, 312 345, 230 350
                 C 148 345, 130 280, 132 220
                 C 135 155, 160 110, 230 110 Z"
              fill="url(#furBodyGrad)"
            />

            {/* Fluffy Hair Tuft on Head */}
            <path
              d="M 195 116
                 C 190 85, 225 72, 245 78
                 C 265 82, 280 98, 275 120
                 C 260 112, 240 110, 220 114
                 C 208 116, 202 118, 195 116 Z"
              fill="#38bdf8"
            />
            <path
              d="M 220 78 C 235 68, 255 70, 260 86 C 248 82, 232 80, 220 78 Z"
              fill="#bae6fd"
            />

            {/* Waving Arm (Right Arm raised high) */}
            <g className="mascot-waving-arm">
              <path
                d="M 315 210
                   C 335 180, 360 140, 355 105
                   C 352 88, 336 82, 324 95
                   C 314 105, 305 135, 298 175
                   C 294 195, 305 212, 315 210 Z"
                fill="url(#furArmGrad)"
              />
              {/* Cute Waving Paw / Hand */}
              <ellipse cx="342" cy="94" rx="20" ry="24" fill="#38bdf8" transform="rotate(-15 342 94)" />
              <circle cx="330" cy="80" r="6" fill="#7dd3fc" />
              <circle cx="342" cy="76" r="6.5" fill="#7dd3fc" />
              <circle cx="355" cy="80" r="6" fill="#7dd3fc" />
            </g>

            {/* Playful Pink Smiling Mouth */}
            <path
              d="M 206 204
                 C 214 222, 246 222, 254 204
                 C 258 200, 264 206, 252 216
                 C 240 226, 220 226, 208 216
                 C 196 206, 202 200, 206 204 Z"
              fill="url(#pinkSmileGrad)"
            />
            {/* Cute glossy lip highlight */}
            <ellipse cx="230" cy="209" rx="10" ry="2.5" fill="rgba(255,255,255,0.7)" />

            {/* Shy/Happy Eyes (Curved happy slits or glossy beads) */}
            <path d="M 204 180 Q 212 174 220 180" stroke="#082f49" strokeWidth="3" strokeLinecap="round" />
            <path d="M 240 180 Q 248 174 256 180" stroke="#082f49" strokeWidth="3" strokeLinecap="round" />

            {/* Floating File Capsule Badge */}
            <g className="mascot-floating-badge" transform="translate(60, 160)">
              <rect x="0" y="0" width="80" height="92" rx="16" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
              <rect x="14" y="16" width="52" height="36" rx="8" fill="url(#filePillGrad)" />
              {/* File glyph */}
              <path d="M 32 28 L 44 28 L 48 32 L 48 44 L 32 44 Z" fill="#0284c7" />
              <text x="40" y="70" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="700" letterSpacing="0.05em">DIRECT</text>
            </g>
          </g>
        </svg>
      </div>
    );
  }

  // Default: 'solar' theme (Image 2 style: 3D character riding rocket with laptop)
  return (
    <div
      ref={containerRef}
      className={`hero-mascot-container mascot-solar ${isPaused ? 'mascot-paused' : ''} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 520 440"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="hero-mascot-svg"
      >
        <defs>
          {/* Ground drop shadow */}
          <radialGradient id="solarGroundShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(180, 83, 9, 0.4)" />
            <stop offset="70%" stopColor="rgba(217, 119, 6, 0.12)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
          </radialGradient>

          {/* Rocket Fuselage Clay Shading */}
          <linearGradient id="rocketBodyGrad" x1="30%" y1="0%" x2="70%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#f1f5f9" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>

          {/* Nose Cone & Fin Orange */}
          <linearGradient id="rocketOrangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>

          {/* Jet Thruster Flame */}
          <linearGradient id="thrusterFireGrad" x1="100%" y1="50%" x2="0%" y2="50%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="40%" stopColor="#3b82f6" />
            <stop offset="70%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>

          {/* Porthole Blue Glass */}
          <radialGradient id="portholeGlass" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="60%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0c4a6e" />
          </radialGradient>

          {/* Character Aviator Helmet Blue */}
          <radialGradient id="helmetGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="65%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0369a1" />
          </radialGradient>

          {/* Character Clay Skin */}
          <radialGradient id="skinGrad" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#fed7aa" />
            <stop offset="75%" stopColor="#fba471" />
            <stop offset="100%" stopColor="#ea580c" />
          </radialGradient>

          {/* Aviator Goggles Glass */}
          <linearGradient id="goggleGlass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e0f2fe" />
            <stop offset="100%" stopColor="#7dd3fc" />
          </linearGradient>

          {/* Exhaust Cloud */}
          <radialGradient id="cloudGrad" cx="45%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#fef3c7" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient Ground Shadow */}
        <ellipse cx="270" cy="400" rx="180" ry="24" fill="url(#solarGroundShadow)" />

        {/* Constellation Data Grid lines & points */}
        <g className="mascot-constellation" opacity="0.45">
          <line x1="60" y1="180" x2="140" y2="120" stroke="rgba(255,255,255,0.4)" strokeWidth="1.25" strokeDasharray="3 3" />
          <line x1="140" y1="120" x2="210" y2="160" stroke="rgba(255,255,255,0.4)" strokeWidth="1.25" strokeDasharray="3 3" />
          <line x1="390" y1="110" x2="470" y2="160" stroke="rgba(255,255,255,0.4)" strokeWidth="1.25" strokeDasharray="3 3" />
          <circle cx="60" cy="180" r="3.5" fill="#ffffff" />
          <circle cx="140" cy="120" r="4" fill="#ffffff" />
          <circle cx="470" cy="160" r="4" fill="#ffffff" />
        </g>

        {/* Exhaust Cloud Puffs behind the rocket */}
        <g className="mascot-exhaust-clouds">
          <circle cx="95" cy="305" r="45" fill="url(#cloudGrad)" />
          <circle cx="60" cy="325" r="35" fill="url(#cloudGrad)" />
          <circle cx="125" cy="330" r="38" fill="url(#cloudGrad)" />
        </g>

        {/* Main Floating Rocket + Character Rig */}
        <g className="mascot-flight-rig">
          {/* Thruster Jet Nozzle */}
          <path d="M 160 260 L 138 274 L 144 296 L 168 290 Z" fill="#64748b" />
          <path d="M 136 272 L 115 284 L 122 304 L 143 294 Z" fill="#334155" />

          {/* Fire Stream / Plasma Cone */}
          <path
            className="mascot-flame"
            d="M 120 286
               C 80 300, 30 310, 10 320
               C 40 335, 90 325, 126 300 Z"
            fill="url(#thrusterFireGrad)"
          />

          {/* Bottom Wing Fin */}
          <path d="M 190 286 L 195 330 L 225 315 L 235 272 Z" fill="url(#rocketOrangeGrad)" />

          {/* Main Sleek Fuselage (Capsule Shape) */}
          <path
            d="M 160 270
               C 175 220, 255 190, 335 210
               C 380 220, 420 250, 430 265
               C 425 285, 360 325, 275 320
               C 215 315, 170 305, 160 270 Z"
            fill="url(#rocketBodyGrad)"
          />

          {/* Top Wing Fin */}
          <path d="M 180 230 L 190 190 L 216 205 L 218 226 Z" fill="url(#rocketOrangeGrad)" />

          {/* Shiny Orange Rocket Nose Cone */}
          <path
            d="M 390 236
               C 420 250, 440 260, 452 268
               C 438 284, 410 298, 385 304
               C 400 280, 400 255, 390 236 Z"
            fill="url(#rocketOrangeGrad)"
          />

          {/* Circular Porthole Window with Rim */}
          <circle cx="280" cy="275" r="24" fill="#0f172a" />
          <circle cx="280" cy="275" r="20" fill="#38bdf8" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="280" cy="275" r="17" fill="url(#portholeGlass)" />
          {/* Glass specular arc */}
          <path d="M 270 264 A 12 12 0 0 1 290 268" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />

          {/* Character: Legs straddling the rocket */}
          <path
            d="M 285 240
               C 295 260, 305 285, 318 300
               C 328 312, 342 322, 355 318
               C 362 315, 360 305, 350 295
               C 338 282, 325 260, 318 238 Z"
            fill="#1e293b"
          />
          {/* Sneaker */}
          <path
            d="M 342 320
               C 355 328, 370 330, 382 326
               C 388 324, 386 316, 378 314
               L 352 312 Z"
            fill="#0f172a"
          />
          <path d="M 354 324 L 378 322" stroke="#ffffff" strokeWidth="2" />

          {/* Character Body / Torso (Grey Jacket + Light Blue Collar) */}
          <path
            d="M 265 180
               C 285 180, 305 200, 312 240
               L 260 240
               C 255 210, 255 190, 265 180 Z"
            fill="#e2e8f0"
          />
          {/* Cyan Scarf / Collar */}
          <path d="M 260 178 L 300 182 L 315 198 L 270 192 Z" fill="#38bdf8" />

          {/* Character Arm holding Laptop */}
          <path
            d="M 280 195
               C 295 205, 315 220, 335 225
               L 330 236
               C 310 232, 290 216, 276 204 Z"
            fill="#cbd5e1"
          />

          {/* Laptop (Screen angled open + base) */}
          {/* Laptop Base */}
          <path d="M 326 226 L 366 230 L 362 236 L 324 232 Z" fill="#94a3b8" />
          {/* Laptop Display Lid */}
          <path d="M 348 194 L 362 196 L 364 230 L 350 228 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="1" />
          {/* Glowing screen surface */}
          <path d="M 349 196 L 352 197 L 354 228 L 351 227 Z" fill="#67e8f9" />

          {/* Character Head & Friendly Profile */}
          <ellipse cx="282" cy="148" rx="22" ry="24" fill="url(#skinGrad)" />
          {/* Happy nose profile and smile */}
          <path d="M 298 148 C 304 150, 306 156, 300 160 C 295 163, 288 162, 285 160" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" />
          {/* Eye */}
          <ellipse cx="292" cy="142" rx="2.5" ry="3.5" fill="#0f172a" />

          {/* Aviator Helmet (Bright Cyan with ear flaps) */}
          <path
            d="M 260 145
               C 258 118, 280 110, 302 118
               C 312 124, 315 140, 310 152
               C 298 138, 275 138, 260 145 Z"
            fill="url(#helmetGrad)"
          />
          {/* Ear Flap */}
          <path d="M 265 142 L 262 165 C 265 170, 275 168, 276 162 L 274 142 Z" fill="#0284c7" />

          {/* Aviator Goggles resting on forehead */}
          <g transform="translate(274, 120)">
            <rect x="0" y="0" width="34" height="14" rx="7" fill="#0f172a" />
            <rect x="2" y="2" width="14" height="10" rx="5" fill="url(#goggleGlass)" />
            <rect x="18" y="2" width="14" height="10" rx="5" fill="url(#goggleGlass)" />
            <line x1="16" y1="7" x2="18" y2="7" stroke="#ffffff" strokeWidth="2" />
          </g>
        </g>
      </svg>
    </div>
  );
}
