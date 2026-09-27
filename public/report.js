const form = document.getElementById('reportForm');
const code = new URLSearchParams(location.search).get('post');
if (/^[A-Za-z0-9]{6}$/.test(code || '')) form.elements.url.value = `${location.origin}/${code}`;
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  const status = document.getElementById('reportStatus');
  button.disabled = true;
  try {
    const response = await fetch('/api/reports', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '提交失败，请稍后再试。');
    status.textContent = result.id ? `申请已收到，编号 ${result.id}。管理员将核实处理。` : '申请已收到。';
    form.reset();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
