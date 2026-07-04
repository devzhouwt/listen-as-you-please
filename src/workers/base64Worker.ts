/** Base64 解码 Web Worker */
self.onmessage = (e: MessageEvent<{ base64: string; id: number }>) => {
  const { base64, id } = e.data;
  
  try {
    // Base64 → 二进制字符串 → Uint8Array → ArrayBuffer
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    self.postMessage(
      { id, buffer: bytes.buffer, success: true },
      { transfer: [bytes.buffer] }
    );
  } catch (error) {
    self.postMessage({ id, success: false, error: String(error) });
  }
};
