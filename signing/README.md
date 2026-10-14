# Release signing key (encrypted backup)

The Android release APK is signed in CI with a keystore stored in GitHub
Actions secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEYSTORE_ALIAS`).

This folder carries an **AES-256 encrypted copy** of that keystore so the
signing key can be recovered if the secrets are ever lost (losing it means
users must uninstall/reinstall to update the app).

## Files

| File                          | What it is                                       |
| ----------------------------- | ------------------------------------------------ |
| `whatsapp-viewer.keystore.enc` | PKCS12 keystore, AES-256-CBC + PBKDF2 encrypted  |

## Recover

```bash
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in signing/whatsapp-viewer.keystore.enc \
  -out whatsapp-viewer.keystore \
  -pass pass:<PASSWORD>
```

- The decryption password is **not** stored in this repository — keep it in
  your password manager. It was shared in the chat where the key was created
  (2026-10-14).
- Alias: `whatsapp-viewer` · Type: PKCS12 · Key: RSA 2048 · Validity: 30 years
- The same password is both the store password and the key password.
