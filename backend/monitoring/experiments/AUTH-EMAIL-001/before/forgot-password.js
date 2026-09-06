import http from "k6/http";
import { check } from "k6";

export const options = {
    vus: 50,
    duration: "20s",

    thresholds: {
        http_req_failed: ["rate<0.05"],
    },
};

export default function () {

    const email =
        `loadtest-user-${__VU}@example.com`;

    const payload = JSON.stringify({
        email,
    });

    const params = {
        headers: {
            "Content-Type": "application/json",
        },
    };

    const response = http.post(
        "http://localhost:3000/api/auth/forgot-password",
        payload,
        params
    );

    check(response, {
        "status is 200": (r) => r.status === 200,
    });
}