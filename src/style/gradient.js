// Vanilla JS Scharr gradient + grayscale conversion. Operates on ImageData.
// Returns Float32Arrays of length (width × height) for dx and dy.
//
// Scharr is preferred over Sobel for small kernels — better rotational symmetry.
// We deliberately skip Gaussian smoothing in v0.1 to minimise per-pixel work;
// the painterly result still reads fine because each stroke covers many pixels.

export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

export function computeScharr(gray, width, height) {
  const dx = new Float32Array(gray.length);
  const dy = new Float32Array(gray.length);
  // Skip the 1-pixel border (gradient undefined there); leave it as zero.
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i00 = (y - 1) * width + (x - 1);
      const i01 = (y - 1) * width + x;
      const i02 = (y - 1) * width + (x + 1);
      const i10 = y * width + (x - 1);
      const i12 = y * width + (x + 1);
      const i20 = (y + 1) * width + (x - 1);
      const i21 = (y + 1) * width + x;
      const i22 = (y + 1) * width + (x + 1);

      dx[rowOff + x] =
        -3 * gray[i00] + 3 * gray[i02]
        - 10 * gray[i10] + 10 * gray[i12]
        - 3 * gray[i20] + 3 * gray[i22];
      dy[rowOff + x] =
        -3 * gray[i00] - 10 * gray[i01] - 3 * gray[i02]
        + 3 * gray[i20] + 10 * gray[i21] + 3 * gray[i22];
    }
  }
  return { dx, dy };
}
