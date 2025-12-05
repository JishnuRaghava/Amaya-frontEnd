// idea2.js (updated: accepts backend returning `true` as success)
const container = document.getElementById('container');
const registerBtn = document.getElementById('register');
const loginBtn = document.getElementById('login');

// Use window.__API_BASE__ if set, otherwise fallback to localhost for dev
const API_BASE = window.__API_BASE__ || "http://localhost:8082";

registerBtn.addEventListener('click', () => {
    container.classList.add("active");
});

loginBtn.addEventListener('click', () => {
    container.classList.remove("active");
});

async function handleSubmitSignIn(event) {
    event.preventDefault(); // must be first line

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email || !password) {
        alert("Please enter both email and password");
        return;
    }

    const loginData = { email, password };

    try {
        console.log("Using API base:", API_BASE);
        console.log("Posting to:", `${API_BASE}/login`);

        // Ask fetch to not automatically follow redirects so we can detect 302/301
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData),
            redirect: "manual"
        });

        console.log("Fetch result -> status:", response.status, "redirected:", response.redirected, "url:", response.url);

        // If server attempted to redirect (e.g. Spring Security formLogin), treat as failure
        if (response.status === 302 || response.status === 301 || response.redirected || response.type === "opaqueredirect") {
            console.warn("Server sent a redirect. Treating as login failure.");
            alert("Invalid email or password");
            return;
        }

        // If server didn't return JSON, treat as failure (prevents HTML login page being considered success)
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            console.warn("Unexpected content-type:", contentType);
            // For debugging you can uncomment the next lines to see server HTML/text:
            // const text = await response.text(); console.log("Response text:", text);
            alert("Login failed (unexpected response from server).");
            return;
        }

        // Parse JSON safely
        const data = await response.json();
        console.log("Response JSON:", data);

        // Recognize common success signals
        const okByPayload = Boolean(
            data === true ||                    // <----- accept `true` returned by backend
            (data && data.token) ||
            (data && data.success === true) ||
            (data && data.user) ||
            (data && data.id)
        );

        // If status is 200 and payload indicates success -> redirect
        if (response.status === 200 && okByPayload) {
            // store token if present
            if (data && data.token) localStorage.setItem("token", data.token);
            console.log("Login confirmed by payload — redirecting to dashboard.");
            window.location.href = "/Dashboard.html";
            return;
        }

        // Handle explicit auth failures
        if (response.status === 401 || response.status === 403) {
            alert("Invalid email or password");
            return;
        }

        // Anything else -> failure
        alert("Login failed. Please check your credentials.");
    } catch (error) {
        console.error("Network Error:", error);
        alert("Error occurred while connecting to server");
    }
}


/* ---------- Register logic (kept consistent with API_BASE) ---------- */
async function handleSubmitRegister(event) {
    event.preventDefault();

    const email = document.getElementById("email-reg").value;
    const name = document.getElementById("name").value;
    const password = document.getElementById("password-reg").value;

    if (!email || !name || !password) {
        alert("Please fill all registration fields");
        return;
    }

    const loginData = { email, name, password };
    const baseURL = `${API_BASE}/register`;

    try {
        console.log("Posting register to:", baseURL);
        const response = await fetch(baseURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData),
            redirect: "manual"
        });

        console.log("Register response status:", response.status);

        // prefer 201 or 200 for success on register
        if (response.status === 200 || response.status === 201) {
            const data = await response.json();
            console.log("Signup Success:", data);
            alert("Registration successful. You can now sign in.");
            // optionally switch UI to sign-in panel
            container.classList.remove("active");
        } else {
            // show server message if available
            let msg = `Signup failed. Status: ${response.status}`;
            try {
                const err = await response.json();
                if (err && err.message) msg = err.message;
            } catch (e) { /* ignore non-json error body */ }
            alert(msg);
        }
    } catch (error) {
        console.error("Network Error:", error);
        alert("Error occurred while connecting to server");
    }
}
