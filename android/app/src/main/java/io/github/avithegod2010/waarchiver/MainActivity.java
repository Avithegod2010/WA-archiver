package io.github.avithegod2010.waarchiver;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Standard Capacitor entry activity, extended (Task A4) so that WhatsApp
 * exports opened from a file manager (ACTION_VIEW) or shared into the app
 * (ACTION_SEND / ACTION_SEND_MULTIPLE) are forwarded into the WebView via
 * {@code window.__WA_INTENT__(payload)} — decoded on the web side by
 * src/lib/intent-router.ts.
 *
 * Payload shapes:
 *   {kind:'text', name, text}          — raw EXTRA_TEXT strings (cap ~10 MB)
 *   {kind:'file', name, mime, b64}     — content/file Uris, base64 (cap ~60 MB)
 *
 * launchMode is singleTask, so sharing into a running app arrives via
 * onNewIntent instead of a second instance.
 */
public class MainActivity extends BridgeActivity {

    /** Cap for raw text payloads (~10 MB). */
    private static final long MAX_TEXT_BYTES = 10L * 1024 * 1024;
    /** Cap for binary/file payloads (~60 MB). Oversized streams are truncated;
     * parsing the truncated file then fails with a visible error in the app. */
    private static final long MAX_FILE_BYTES = 60L * 1024 * 1024;
    /** One delayed retry when the bridge/WebView is not ready yet (cold start). */
    private static final long RETRY_DELAY_MS = 800L;

    /** Payload stashed while the WebView finishes initialising. */
    private JSONObject pendingPayload;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        try {
            String action = intent.getAction();
            if (Intent.ACTION_VIEW.equals(action)) {
                Uri data = intent.getData();
                if (data != null) sendUri(data);
            } else if (Intent.ACTION_SEND.equals(action)) {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    sendUri(stream);
                } else {
                    CharSequence extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                    if (extraText != null) sendText(extraText.toString(), null);
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> streams =
                        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streams != null) {
                    for (Uri uri : streams) {
                        if (uri != null) sendUri(uri);
                    }
                }
            }
        } catch (Exception e) {
            // Never crash on malformed or unexpected intents.
        }
    }

    /** Wrap a raw EXTRA_TEXT string as a {kind:'text'} payload for the router. */
    private void sendText(String text, String name) {
        if (text == null || text.isEmpty()) return;
        try {
            if (text.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) {
                // Truncate oversized text at the cap (char-boundary safe enough
                // for transcripts; the web parser tolerates partial lines).
                int maxChars = (int) (MAX_TEXT_BYTES / 4);
                if (maxChars < text.length()) text = text.substring(0, maxChars);
            }
            JSONObject payload = new JSONObject();
            payload.put("kind", "text");
            payload.put("name", name != null ? name : "shared-text.txt");
            payload.put("text", text);
            dispatchToJs(payload);
        } catch (Exception e) {
            // ignore — intent handling must never crash the app
        }
    }

    /**
     * Read a content/file Uri via ContentResolver and forward it as a base64
     * {kind:'file'} payload (mime from ContentResolver.getType).
     */
    private void sendUri(Uri uri) {
        try {
            ContentResolver cr = getContentResolver();
            String mime = cr.getType(uri);
            if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
            String name = queryDisplayName(cr, uri);
            if (name == null || name.isEmpty()) name = "shared-file";

            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            InputStream in = cr.openInputStream(uri);
            if (in == null) return;
            try {
                byte[] buf = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = in.read(buf)) != -1) {
                    if (total + read > MAX_FILE_BYTES) {
                        int remaining = (int) (MAX_FILE_BYTES - total);
                        if (remaining > 0) bos.write(buf, 0, remaining);
                        break; // truncate at the ~60 MB cap
                    }
                    bos.write(buf, 0, read);
                    total += read;
                }
            } finally {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }

            JSONObject payload = new JSONObject();
            payload.put("kind", "file");
            payload.put("name", name);
            payload.put("mime", mime);
            payload.put("b64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            dispatchToJs(payload);
        } catch (Exception e) {
            // ignore — unreadable/oversized providers must not crash the app
        }
    }

    /** Best-effort DISPLAY_NAME lookup for a content Uri. */
    private String queryDisplayName(ContentResolver cr, Uri uri) {
        Cursor cursor = null;
        try {
            cursor = cr.query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    /**
     * Deliver a payload to JS: evaluateJavascript window.__WA_INTENT__({...})
     * on the UI thread. If the bridge/WebView is not ready yet (cold start
     * straight into a VIEW/SEND intent) the payload is stashed and retried
     * once after {@link #RETRY_DELAY_MS}.
     */
    private void dispatchToJs(JSONObject payload) {
        if (payload == null) return;
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            final String script = buildScript(payload);
            web.post(() -> web.evaluateJavascript(script, null));
            return;
        }
        // Bridge not ready yet (rare — Capacitor finishes init inside
        // super.onCreate) — stash and retry once shortly.
        pendingPayload = payload;
        getWindow().getDecorView().postDelayed(() -> {
            JSONObject retry = pendingPayload;
            pendingPayload = null;
            if (retry == null) return;
            WebView w = getBridge() != null ? getBridge().getWebView() : null;
            if (w != null) {
                final String script = buildScript(retry);
                w.post(() -> w.evaluateJavascript(script, null));
            }
        }, RETRY_DELAY_MS);
    }

    /** window.__WA_INTENT__ call with an inline guard (hook may not be installed yet). */
    private static String buildScript(JSONObject payload) {
        return "if(window.__WA_INTENT__){window.__WA_INTENT__(" + payload + ")}";
    }
}
