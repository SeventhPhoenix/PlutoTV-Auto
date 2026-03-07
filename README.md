# 🌎 Pluto TV Playlists (Auto-Updating)

![Auto Update](https://img.shields.io/badge/JWT-Auto%20Refreshed-brightgreen)

Automatically generates and refreshes a **Pluto TV M3U playlist** with a valid session token using GitHub Actions.

Each user must generate their own unique `client_id` (UUID). This prevents playback conflicts and ensures stable stream access.

---

## 🚀 How It Works

- GitHub Actions runs on a schedule.
- A fresh Pluto session JWT is requested.
- The M3U playlist is regenerated using:
  - Your unique `client_id`
  - A valid session token
- The updated playlist is committed to your fork.

No manual token updates required.

---

# 📌 Setup Instructions

## 1️⃣ Fork This Repository

Click **Fork** (top right of this page).

You now have your own independent copy.

---

## 2️⃣ Generate a Unique Client ID (UUID)

You must generate your own UUID.

Use:
https://www.uuidgenerator.net/

Example:
9a1cce51-2d2f-4b6c-9f8e-1e2d0a3b4c5d

Copy your generated UUID.

---

## 3️⃣ Edit `config.json`

In your fork:

Open `config.json` and replace:

{
  "client_id": "PASTE_YOUR_UNIQUE_UUID_HERE"
}

With:

{
  "client_id": "your-generated-uuid-here"
}

Commit the change.

---

## 4️⃣ Run the Workflow

1. Go to the **Actions** tab.
2. Select **Auto Pluto Update**.
3. Click **Run workflow**.
4. Wait for it to complete.

Your playlist will now be generated.

After that, it will auto-update on schedule.

---

# 📂 Access Your Playlist

After the workflow completes:

1. Open the `output/` folder.
2. Locate:
   plutotv_us.m3u8
3. Click **Raw**
4. Copy the URL.

### RAW URL Format

https://raw.githubusercontent.com/YOUR_USERNAME/REPO_NAME/main/output/plutotv_us.m3u8

Add this URL to your IPTV player:

- TiviMate
- IPTV Smarters
- OTT Navigator
- VLC
- Any M3U-compatible player

---

# 🔄 Automatic Token Refresh

The workflow automatically:

- Requests a fresh Pluto session token
- Regenerates playlist URLs
- Commits updated files

Tokens expire regularly.  
This automation ensures your playlist remains valid.

---

# 📺 EPG (Electronic Program Guide)

https://raw.githubusercontent.com/matthuisman/i.mjh.nz/refs/heads/master/PlutoTV/all.xml

---

# ⚠️ Important Notes

- Do not share your generated playlist publicly.
- Each user must use their own UUID.
- Excessive requests may result in temporary IP rate limiting.
- This project is for personal use.

---

# 🙏 Credits

Based on:
https://github.com/4v3ngR/pluto_tv_scraper

EPG data provided by:
https://github.com/matthuisman/i.mjh.nz
