# VivLift Web (PWA) - the friendly receptionist on phones and tablets

Works in the browser on Android and iPhone, installs to the home screen like an app, and runs
**without internet after the first visit**. Same conversation as the Windows version
(Welcomer, Listener, Presenter), same school setup, PIN, recovery code and school packs.

- **Ears:** Whisper `base.en`, running inside the browser (smaller than the Windows model)
- **Mouth:** the phone's own built-in voices (offline)

## 1. Prepare the files (once, on a computer with internet)
```
python prepare.py
```
Downloads the speech library into `lib/` and the speech model (~75 MB) into `models/`.
Nothing to install; Python 3 is enough.

Optional test on the same computer: `python -m http.server 8000`, then open `http://localhost:8000`
in Chrome. (Microphones only work on `localhost` or `https`.)

## 2. Upload to any web host
Upload the **entire folder** (keep the sub-folders `lib/` and `models/`) to a host that serves **HTTPS**
(for example GitHub Pages, Netlify, or any cPanel host with an SSL certificate).
It must be HTTPS or the browser will block the microphone.
You can put it in a sub-folder (for example `yoursite.com/vivlift/`); all links are relative.

## 3. On each phone or tablet (first time, with internet)
1. Open the web address in Chrome (Android) or Safari (iPhone/iPad).
2. Wait for "Ready. VivLift now works without internet." (the first download is ~75 MB).
3. Install: Android - "Install VivLift" button or the browser menu; iPhone - Share > Add to Home Screen.
4. Allow the microphone when asked.
5. First launch shows the school setup screen. Create a PIN and write down the recovery code.

After this, switch off Wi-Fi and data to confirm it still works.

## Settings and PIN
- Open Settings by tapping the small word **VivLift** (top right) **five times quickly**.
  On a computer, Ctrl + Shift + S also works.
- School name, how-to-say-it, motto, logo, class system, voices, microphone sensitivity,
  say-it-this-way list, save-records switch, PIN.
- Forgot the PIN: type the recovery code (VL-XXXX-XXXX) in the PIN box and choose a new PIN.
- 5 wrong PINs lock Settings for 5 minutes.
- **School packs** are compatible with the Windows app: export on one device, import on another
  (the school, logo and PIN come across; voices are chosen per device).
- Records are kept on the device. Settings > "Export records (CSV)" downloads them.

## Voices
Browsers cannot use Piper easily, so this version uses voices already on the phone.
On Android, open the phone's text-to-speech settings and install **English (Nigeria)** or
**English (UK)** voices; then pick a female and a male voice in Settings and press Test.
iPhones include several British English voices.

## Updating the app
After changing any file, edit `sw.js` and raise `vivlift-shell-v1` to `v2` so phones fetch the update.
The big speech files are kept, so they are not downloaded again.

## Honest limits
- Written and logic-tested without real phones. Expect a test round on a few devices.
- The smaller model is less accurate with names, and this version cannot give Whisper the
  "Nigerian names and subjects" hint the Windows version uses. Hence the spoken name check and typing box.
- iPhone may lower the voice volume while the microphone is active, and can clear stored data of
  sites that go unused for weeks (an installed home-screen app is much safer). If the speech
  engine is ever cleared, the device needs internet once to download it again.
- Quiet room recommended. Adjust "Microphone sensitivity" in Settings if it cuts off or never stops.
