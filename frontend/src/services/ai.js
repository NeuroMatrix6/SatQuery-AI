const API_BASE = "https://satquery-ai-backend-r165.onrender.com";

export async function askVQA({ file, question }) {
  if (!file) throw new Error("Please select a satellite image.");
  if (!question?.trim()) throw new Error("Please enter a question.");

  const formData = new FormData();
  formData.append("image", file, file.name);
  formData.append("question", question.trim());

  const response = await fetch(`${API_BASE}/api/vqa`, {
    method: "POST",
    body: formData,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(`Backend returned HTTP ${response.status}.`);
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error || `AI API error: ${response.status}`
    );
  }

  return data;
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/api/health`);

  if (!response.ok) {
    throw new Error("Backend is not reachable.");
  }

  return response.json();
}