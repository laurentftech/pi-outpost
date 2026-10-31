# Design

## 1. The same frame, another source
A picture frame names its source by one attribute: `data-drawio` for a diagram drawn by the
viewer, `data-picture-file` for a file used as it is. Both resolve the same way (from the poster's
directory, or from the root with `/`), fill an empty frame on open, leave a filled one alone, and
name what failed. A frame carrying both is drawn from `data-drawio`.

## 2. Bytes through the viewer's own route
The editor frame holds no credentials and reads nothing. It asks its parent, which fetches the file
from the server's raw route with its token, as the viewer does for a page's sibling files
(`loadPageResource`), and posts back the bytes and their media type. The server's read zone
applies.

## 3. SVG kept, rasters scaled
An SVG is embedded as its own text, base64 in a data URL, kept below 2 MB like a diagram. As a
picture it is drawn inside an `<img>`, where its scripts do not run and nothing it names is
fetched. A raster goes through the editor's own `embeddablePicture`, as a picture chosen from the
person's computer does: at most 1200 px, PNG when it may hold transparency, JPEG otherwise. A file
above 20 MB is refused before it is read into the poster.

## 4. Listing
The server's name search (`search_files`, capped at 20 per query) is asked once per extension, so a
project with many pictures lists the first ones of each kind; the list says nothing about the
others. Paths are offered as a frame writes them.
