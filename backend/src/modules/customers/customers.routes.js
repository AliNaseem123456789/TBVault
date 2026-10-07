import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { listCustomers, getCustomer, setCustomerBlocked } from "./customers.controller.js";

const router = Router()

router.get("/admin/customers", requireAdmin, listCustomers)
router.get("/admin/customers/:userId", requireAdmin, getCustomer)
router.patch("/admin/customers/:userId/block", requireAdmin, setCustomerBlocked)

export default router
