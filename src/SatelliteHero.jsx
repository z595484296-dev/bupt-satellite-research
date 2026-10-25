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
      {/* 抠出的卫星单独一层：背景地球可以柔和融入页面，卫星本身始终完整清晰 */}
      <div className="satellite-object" aria-hidden="true">
        <img
          src="/assets/satellite-object-v1.webp"
          alt=""
          width="1852"
          height="849"
          fetchPriority="high"
          decoding="async"
        />
      </div>
    </div>
  );
}
