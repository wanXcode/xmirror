// "{name}" placeholder filling for server-rendered strings.
function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole));
}

module.exports = { fill };
