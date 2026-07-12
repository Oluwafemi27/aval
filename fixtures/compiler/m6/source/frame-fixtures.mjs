export const FRAME_WIDTH = 45;
export const FRAME_HEIGHT = 27;

const TAG_COLUMNS = Object.freeze([
  0b000111,
  0b001011,
  0b001101,
  0b001110,
  0b010011,
  0b100011
]);

export const FRAME_BACKGROUNDS = Object.freeze([
  [76, 84, 92], [84, 92, 96], [92, 96, 100],
  [100, 100, 100], [108, 100, 96], [112, 108, 96], [108, 116, 100],
  [100, 120, 104], [92, 116, 108], [88, 108, 108], [92, 100, 104],
  [96, 100, 108], [96, 100, 116], [96, 100, 124], [96, 100, 132],
  [96, 100, 140], [96, 100, 148],
  [100, 100, 152], [108, 100, 148], [112, 108, 148], [108, 116, 152],
  [100, 120, 156], [92, 116, 160], [88, 108, 160], [92, 100, 156],
  [96, 98, 103], [96, 94, 107], [96, 90, 111], [96, 94, 109],
  [96, 98, 105]
]);

export function taggedFrame(background, frameIndex, transparent) {
  const rgba = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 4);
  const movingPatchX = 2 + (frameIndex & 1);
  const gray = Math.round((background[0] + background[1] + background[2]) / 3);
  const visibleColor = [gray, gray, gray];
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const offset = (y * FRAME_WIDTH + x) * 4;
      let alpha = 255;
      if (transparent) {
        alpha = 0;
        if (x < 32) {
          if (y === 8 || y === 24) alpha = 64;
          else if (y === 9 || y === 23) alpha = 128;
          else if (y === 10 || y === 22) alpha = 192;
          else if (y === 11) alpha = 224;
          else if (y >= 12 && y <= 21) alpha = 255;
        }
        if (
          y === 21 &&
          x >= movingPatchX &&
          x < movingPatchX + 4
        ) {
          alpha = 0;
        }
      }
      if (alpha === 0) {
        rgba.set(
          (x + y) % 2 === 0
            ? [255, 0, 255, 0]
            : [0, 255, 0, 0],
          offset
        );
      } else {
        rgba.set([...visibleColor, alpha], offset);
      }
    }
  }
  const code = tagCode(frameIndex);
  for (let bit = 0; bit < 6; bit += 1) {
    const value = (code & (1 << bit)) === 0 ? 32 : 224;
    for (let y = 13; y < 21; y += 1) {
      for (let x = 2 + bit * 5; x < 5 + bit * 5; x += 1) {
        const offset = (y * FRAME_WIDTH + x) * 4;
        rgba.set([value, value, value, 255], offset);
      }
    }
  }
  return rgba;
}

function tagCode(frameIndex) {
  const gray = frameIndex ^ (frameIndex >> 1);
  return TAG_COLUMNS.reduce(
    (code, column, bit) => (gray & (1 << bit)) === 0 ? code : code ^ column,
    0
  );
}
