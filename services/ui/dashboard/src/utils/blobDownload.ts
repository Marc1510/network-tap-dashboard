/**
 * Lädt einen Blob als Datei herunter.
 * 
 * @param blob - Der Blob, der heruntergeladen werden soll
 * @param options - Optionale Parameter
 * @param options.contentDisposition - Content-Disposition Header-String zum Extrahieren des Dateinamens
 * @param options.fallbackFilename - Fallback-Dateiname, wenn kein Dateiname aus dem Header extrahiert werden kann
 */
export function downloadBlob(
  blob: Blob,
  options?: {
    contentDisposition?: string | null;
    fallbackFilename?: string;
  }
): void {
  const { contentDisposition, fallbackFilename = 'download' } = options || {};

  // Versuche Dateinamen aus Content-Disposition Header zu extrahieren
  let filename = fallbackFilename;
  if (contentDisposition) {
    // Versuche zuerst filename*= (RFC 5987) und dann filename=
    const match = contentDisposition.match(/filename\*?=["']?([^"';]+)["']?/i);
    if (match) {
      filename = match[1].trim();
      // Entferne mögliche Anführungszeichen am Anfang und Ende
      filename = filename.replace(/^["']|["']$/g, '');
    }
  }

  // Download auslösen
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

