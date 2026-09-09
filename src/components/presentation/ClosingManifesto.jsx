import React from 'react';

export default function ClosingManifesto({ lines = [], signature }) {
  return (
    <div className="max-w-4xl">
      {lines.map((line, i) => (
        <p
          key={i}
          className={
            i === 0
              ? 'text-2xl md:text-4xl font-bold leading-tight bg-gradient-to-r from-white via-white to-[#FF6600] bg-clip-text text-transparent'
              : 'mt-5 text-base md:text-xl text-gray-300 leading-relaxed'
          }
        >
          {line}
        </p>
      ))}
      {signature && (
        <p className="mt-8 text-[#FF6600] font-semibold text-lg md:text-xl">{signature}</p>
      )}
    </div>
  );
}