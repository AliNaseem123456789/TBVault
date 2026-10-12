import api from "./apiClient";

/** The AI shopping assistant (backend /api/chat, which forwards to the Python chatbot service). */

// history: earlier turns [{ role: "user" | "assistant", content }]
export const sendChat = async (message, history = []) =>
  (await api.post("/chat", { message, history }, { timeout: 60000 })).data;

export const sendChatImage = async (file, message = "") => {
  const form = new FormData();
  form.append("image", file);
  if (message) form.append("message", message);
  return (await api.post("/chat/image", form, { timeout: 60000 })).data;
};

// Hybrid search without the chat: { query, category_id?, brand_id?, min_price?, max_price?, in_stock?, on_sale?, limit? }
export const smartSearch = async (params) => (await api.get("/search/smart", { params })).data;

// Visual search: a photo, or words describing a look ("red sneakers").
export const searchByImage = async ({ file, query }) => {
  const form = new FormData();
  if (file) form.append("image", file);
  if (query) form.append("query", query);
  return (await api.post("/search/image", form)).data;
};
