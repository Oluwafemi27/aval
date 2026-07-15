import { deriveAvcRenditionGeometry } from "@pixel-point/aval-format";
import { describe, expect, it } from "vitest";

import { BrowserFrameBackend } from "./frame-renderer-browser.js";
import type { FrameTextureLayout } from "./frame-renderer.js";

const LAYOUT: FrameTextureLayout = {
  geometry: deriveAvcRenditionGeometry({
    profile: "avc-annexb-packed-alpha-v0",
    canvasWidth: 3,
    canvasHeight: 1,
    colorRect: [0, 0, 3, 1],
    alphaRect: [0, 10, 3, 1],
    codedWidth: 16,
    codedHeight: 16
  }),
  logicalWidth: 3,
  logicalHeight: 1,
  residentLayerCount: 1
};

describe("BrowserFrameBackend lifecycle reentrancy", () => {
  it("does not allocate GPU resources after a canvas setter disposes it", () => {
    const fixture = createLifecycleHost();
    const backend = new BrowserFrameBackend(fixture.canvas);
    fixture.setWidthAction(() => backend.dispose());

    expect(() => backend.allocate(LAYOUT, 3)).toThrow("disposed");
    expectAllGlResourcesReleased(fixture.gl);
    expect(fixture.gl.createdPrograms).toHaveLength(0);
    expect(fixture.gl.createdVertexArrays).toHaveLength(0);
    expect(fixture.gl.createdTextures).toHaveLength(0);
    expect(() => backend.allocate(LAYOUT, 3)).toThrow("disposed");
  });

  it("releases resources created after allocation reenters disposal", () => {
    const fixture = createLifecycleHost();
    const backend = new BrowserFrameBackend(fixture.canvas);
    fixture.gl.createProgramAction = () => backend.dispose();

    expect(() => backend.allocate(LAYOUT, 3)).toThrow("disposed");
    expectAllGlResourcesReleased(fixture.gl);
    expect(() => backend.draw("stream", 0)).toThrow("disposed");
  });

  it("fails terminally when texture upload reenters disposal", () => {
    const fixture = createLifecycleHost();
    const backend = new BrowserFrameBackend(fixture.canvas);
    backend.allocate(LAYOUT, 3);
    fixture.gl.uploadAction = () => backend.dispose();

    expect(() => backend.upload(
      "resident",
      0,
      new Uint8Array(16 * 16 * 4)
    )).toThrow("disposed");
    expectAllGlResourcesReleased(fixture.gl);
    expect(() => backend.upload(
      "resident",
      0,
      new Uint8Array(16 * 16 * 4)
    )).toThrow("disposed");
  });

  it("does not commit a draw that reenters disposal", () => {
    const fixture = createLifecycleHost();
    const backend = new BrowserFrameBackend(fixture.canvas);
    backend.allocate(LAYOUT, 3);
    fixture.gl.drawAction = () => backend.dispose();

    expect(() => backend.draw("resident", 0)).toThrow("disposed");
    expectAllGlResourcesReleased(fixture.gl);
    expect(() => backend.draw("resident", 0)).toThrow("disposed");
  });

  it("does not return pixels when readback reenters disposal", () => {
    const fixture = createLifecycleHost();
    const backend = new BrowserFrameBackend(fixture.canvas);
    backend.allocate(LAYOUT, 3);
    fixture.gl.readAction = () => backend.dispose();

    expect(() => backend.readPixels()).toThrow("disposed");
    expectAllGlResourcesReleased(fixture.gl);
    expect(() => backend.readPixels()).toThrow("disposed");
  });
});

function expectAllGlResourcesReleased(gl: LifecycleGl): void {
  expectExactlyReleased(gl.createdShaders, gl.deletedShaders);
  expectExactlyReleased(gl.createdPrograms, gl.deletedPrograms);
  expectExactlyReleased(gl.createdVertexArrays, gl.deletedVertexArrays);
  expectExactlyReleased(gl.createdTextures, gl.deletedTextures);
}

function expectExactlyReleased<T>(created: readonly T[], deleted: readonly T[]): void {
  expect(deleted).toHaveLength(created.length);
  for (const resource of created) {
    expect(deleted.filter((candidate) => candidate === resource)).toHaveLength(1);
  }
}

function createLifecycleHost(): {
  readonly canvas: HTMLCanvasElement;
  readonly gl: LifecycleGl;
  readonly setWidthAction: (action: (() => void) | null) => void;
} {
  const gl = new LifecycleGl();
  let width = 0;
  let height = 0;
  let widthAction: (() => void) | null = null;
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      widthAction?.();
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
    },
    getContext() {
      return gl as unknown as WebGL2RenderingContext;
    }
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    gl,
    setWidthAction(action) {
      widthAction = action;
    }
  };
}

class LifecycleGl {
  public readonly MAX_TEXTURE_SIZE = 1;
  public readonly MAX_ARRAY_TEXTURE_LAYERS = 2;
  public readonly VERTEX_SHADER = 3;
  public readonly FRAGMENT_SHADER = 4;
  public readonly COMPILE_STATUS = 5;
  public readonly LINK_STATUS = 6;
  public readonly TEXTURE_2D_ARRAY = 7;
  public readonly TEXTURE_MIN_FILTER = 8;
  public readonly TEXTURE_MAG_FILTER = 9;
  public readonly TEXTURE_WRAP_S = 10;
  public readonly TEXTURE_WRAP_T = 11;
  public readonly CLAMP_TO_EDGE = 12;
  public readonly LINEAR = 13;
  public readonly RGBA8 = 14;
  public readonly TEXTURE0 = 15;
  public readonly TRIANGLES = 16;
  public readonly BLEND = 17;
  public readonly ONE = 18;
  public readonly ONE_MINUS_SRC_ALPHA = 19;
  public readonly COLOR_BUFFER_BIT = 20;
  public readonly NO_ERROR = 0;
  public readonly RGBA = 21;
  public readonly UNSIGNED_BYTE = 22;
  public readonly UNPACK_ALIGNMENT = 23;

  public readonly createdShaders: WebGLShader[] = [];
  public readonly deletedShaders: WebGLShader[] = [];
  public readonly createdPrograms: WebGLProgram[] = [];
  public readonly deletedPrograms: WebGLProgram[] = [];
  public readonly createdVertexArrays: WebGLVertexArrayObject[] = [];
  public readonly deletedVertexArrays: WebGLVertexArrayObject[] = [];
  public readonly createdTextures: WebGLTexture[] = [];
  public readonly deletedTextures: WebGLTexture[] = [];
  public createProgramAction: (() => void) | null = null;
  public uploadAction: (() => void) | null = null;
  public drawAction: (() => void) | null = null;
  public readAction: (() => void) | null = null;

  public getParameter(): number { return 8_192; }
  public createShader(): WebGLShader {
    const shader = {} as WebGLShader;
    this.createdShaders.push(shader);
    return shader;
  }
  public shaderSource(): void {}
  public compileShader(): void {}
  public getShaderParameter(): boolean { return true; }
  public deleteShader(shader: WebGLShader): void {
    this.deletedShaders.push(shader);
  }
  public createProgram(): WebGLProgram {
    const program = {} as WebGLProgram;
    this.createdPrograms.push(program);
    this.createProgramAction?.();
    return program;
  }
  public attachShader(): void {}
  public linkProgram(): void {}
  public getProgramParameter(): boolean { return true; }
  public deleteProgram(program: WebGLProgram): void {
    this.deletedPrograms.push(program);
  }
  public createVertexArray(): WebGLVertexArrayObject {
    const vertexArray = {} as WebGLVertexArrayObject;
    this.createdVertexArrays.push(vertexArray);
    return vertexArray;
  }
  public deleteVertexArray(vertexArray: WebGLVertexArrayObject): void {
    this.deletedVertexArrays.push(vertexArray);
  }
  public createTexture(): WebGLTexture {
    const texture = {} as WebGLTexture;
    this.createdTextures.push(texture);
    return texture;
  }
  public deleteTexture(texture: WebGLTexture): void {
    this.deletedTextures.push(texture);
  }
  public bindTexture(): void {}
  public texParameteri(): void {}
  public texStorage3D(): void {}
  public getUniformLocation(): WebGLUniformLocation {
    return {} as WebGLUniformLocation;
  }
  public enable(): void {}
  public blendFunc(): void {}
  public clearColor(): void {}
  public viewport(): void {}
  public clear(): void {}
  public useProgram(): void {}
  public bindVertexArray(): void {}
  public activeTexture(): void {}
  public uniform1i(): void {}
  public uniform1f(): void {}
  public uniform4f(): void {}
  public drawArrays(): void { this.drawAction?.(); }
  public pixelStorei(): void {}
  public texSubImage3D(): void { this.uploadAction?.(); }
  public readPixels(): void { this.readAction?.(); }
  public getError(): number { return this.NO_ERROR; }
  public isContextLost(): boolean { return false; }
}
