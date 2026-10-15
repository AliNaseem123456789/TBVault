import api from "./apiClient";

/**
 * Site-wide forms.
 *   POST /newsletter        { email }                                   footer + homepage sign-up
 *   GET  /contact/topics    -> { data: [topic, ...] }
 *   POST /contact           { name, email, topic, order_ref?, message } Contact us page
 */
export const subscribeNewsletter = async (email) => (await api.post("/newsletter", { email })).data;
export const getContactTopics = async () => (await api.get("/contact/topics")).data;
export const sendContactMessage = async (body) => (await api.post("/contact", body)).data;
