import { useState } from 'react';
import { productImageUrl, type Product } from '../lib/products';

/**
 * The product's illustration from musticker.com, drawn as-is with no tile behind
 * it. Falls back to the first letter of the English name if the image cannot
 * load (offline, or the site renamed it).
 */
export default function ProductThumb({ product, size = 32 }: { product: Product; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = productImageUrl(product);

  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="text-xs font-semibold opacity-50">{product.english.charAt(0)}</span>
      )}
    </span>
  );
}
