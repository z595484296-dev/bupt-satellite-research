import React from "react";

export function SatelliteHero() {
  return (
    <div className="satellite-hero">
      <div className="satellite-hero-plane">
        <img
          src="/assets/satellite-hero-v1.webp"
          alt="近地轨道上的通信卫星"
          width="1852"
          height="849"
          fetchPriority="high"
          decoding="async"
        />
      </div>
    </div>
  );
}
