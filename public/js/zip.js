// Minimal ZIP writer (stored, no compression). Photos are already compressed, so
// "store" keeps files byte-identical and the code small. Runs in browsers and node.
(function (root) {
  var TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function encodeName(name) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(name) : Uint8Array.from(unescape(encodeURIComponent(name)), function (ch) { return ch.charCodeAt(0); });
  }

  // files: [{ name: string, data: Uint8Array }]  ->  Uint8Array of a .zip archive
  function createZip(files, date) {
    var when = date || new Date();
    var dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    var dosDate = ((Math.max(when.getFullYear(), 1980) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();

    var parts = [];
    var central = [];
    var offset = 0;

    function push(bytes) { parts.push(bytes); offset += bytes.length; }

    files.forEach(function (file) {
      var name = encodeName(file.name);
      var data = file.data;
      var crc = crc32(data);
      if (data.length > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('ZIP64 is not supported');

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034B50, true);
      local.setUint16(4, 20, true);        // version needed
      local.setUint16(6, 0x0800, true);    // flags: UTF-8 names
      local.setUint16(8, 0, true);         // method: stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      var entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014B50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);   // offset of the local header
      central.push(new Uint8Array(entry.buffer), name);

      push(new Uint8Array(local.buffer));
      push(name);
      push(data);
    });

    var centralStart = offset;
    central.forEach(push);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, offset - centralStart, true);
    end.setUint32(16, centralStart, true);
    push(new Uint8Array(end.buffer));

    var out = new Uint8Array(offset);
    var position = 0;
    parts.forEach(function (part) { out.set(part, position); position += part.length; });
    return out;
  }

  var api = { createZip: createZip, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPutZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
