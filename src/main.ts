import './style.css'
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/700.css";

(async () => {
  /**
   * The array of files that have been uploaded by the user in this session.
   */
  const currentUpload: File[] = [];
  /**
   * If the function that handles changing the images is running
   */
  let isLoopRunning = false;
  /**
   * The position of the `currentUpload` array that is being shown
   */
  let uploadEntryShown = 0;
  /**
   * A list of the IndexedDB keys that have been displayed.
   * This is used to go back to the previous image, and to delete the current image from the IndexedDB
   */
  let cursorIds: IDBValidKey[] = [];
  /**
   * The promise of either:
   * 
   * - The timeout of the opacity transition between two images
   * 
   * - The timeout after an image has become visible
   */
  let waitPromise: () => void;
  /**
   * The Promise that needs to be resolved when the user has selected if they want to delete the image or not
   */
  let waitDeletePromise: () => void;
  /**
   * The IndexedDB
   */
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open("CustomScreensaverDB", 1);
    req.onupgradeneeded = () => {
      let db = req.result;
      let storage = db.createObjectStore("UploadedFiles", { keyPath: "id" });
      storage.createIndex("name", "name", { unique: false });
      storage.transaction.oncomplete = () => res(db);
      storage.transaction.onerror = (ex) => rej(ex);
    }
    req.onsuccess = () => res(req.result);
    req.onblocked = (ex) => rej(ex);
    req.onerror = (ex) => rej(ex)
  });

  /**
   * The Cursor that is used to get the current image in the IndexedDB
   */
  let cursor: IDBCursorWithValue | null = null;
  
  /**
   * Update the `cursor` object with a new database entry
   * @param range if passed, the function will get the next value after this key
   * @param isFromNull if the function has been called since the cursor is null. In this case, we'll try to get the first item in the IndexedDB
   */
  async function initCursor(range?: IDBKeyRange, isFromNull?: boolean) {
    await new Promise<void>(async (res) => {
      const req = db.transaction(["UploadedFiles"], "readonly").objectStore("UploadedFiles").openCursor(range);
      let hasAdvanced = false;
      req.onsuccess = async () => {
        if (range && !hasAdvanced && req.result) { // The cursor is valid, but it's of the `range` key. We need to get the next one, so we'll continue.
          req.result.continue();
          hasAdvanced = true;
          return; // Here we return since we don't care about this success, but about the next one, that'll have the next image.
        }
        cursor = req.result;
        if (!cursor && !isFromNull) await initCursor(undefined, true);
        res();
      };
      req.onerror = () => res();
    })

  }
  document.getElementById("upload")?.addEventListener("click", () => { // Load the new images
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      multiple: true,
      directory: (document.getElementById("pickFolder") as HTMLInputElement).checked,
      webkitdirectory: (document.getElementById("pickFolder") as HTMLInputElement).checked,
      onchange: () => {
        const files = Array.from(input.files ?? []).filter(item => item.type.startsWith("image/") || item.type.startsWith("video/"));
        currentUpload.push(...files);
        if ((document.getElementById("saveInStorage") as HTMLInputElement).checked) { // Save the images in the IndexedDB
          const store = db.transaction("UploadedFiles", 'readwrite').objectStore("UploadedFiles");
          for (const file of files) store.add({
            name: file.name,
            data: file,
            id: `${Date.now()}-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString()}`
          });
        }
      }
    });
    input.click();
  })
  /**
   * Show or hide the mouse cursor in the `containerDiv`
   * @param hide if the cursor should be hidden or not
   */
  function updateMouseCursor(hide: boolean) {
    document.body.style.setProperty("--img-cursor", `${hide ? "none" : "default"}`)
  }
  /**
   * The div where the images will be added
   */
  const containerDiv = document.getElementById("container") as HTMLDivElement;

  document.getElementById("start")?.addEventListener("click", async () => { // Update the values and go in fullscreen mode
    (document.getElementById("saveInStorage") as HTMLInputElement).checked && await initCursor(); // Get the cursor of the first item, since we'll use the IndexedDB 
    document.body.style.setProperty("--opacity-animation", `${(document.getElementById("transition") as HTMLInputElement).value}ms`);
    updateMouseCursor((document.getElementById("hideCursor") as HTMLInputElement).checked);
    document.body.style.setProperty("--img-filter", (document.getElementById("cssFilter") as HTMLInputElement).value);
    containerDiv.style.top = "0px";
    containerDiv.style.display = "block";
    containerDiv.requestFullscreen({ navigationUI: "hide" });
  });

  /**
   * Set up the images for the screensaver, and switch between them. This function should be called only once, when the application goes into fullscreen mode.
   * @param fromLoop if the function is being called recursively
   */
  async function start(fromLoop: boolean) {
    /**
     * If true, the loop should be paused, so the image should continue to be the same.
     */
    let pauseLoop = false;
    if (isLoopRunning && !fromLoop) return; // Avoid running the function multiple times if it's already being run
    if (!document.fullscreenElement) { // Stop the function since the user exited from fullscreen mode.
      isLoopRunning = false;
      return;
    }
    isLoopRunning = true;
    /**
     * The image that has already been appended. Might be null if it's the first time the user goes into fullscreen mode.
     */
    const prevItem = containerDiv.querySelector("img, video") as HTMLVideoElement | HTMLImageElement;
    /**
     * The new image that needs to be shown
     */
    const firstImage = (cursor?.value.data.type.startsWith("video/") || currentUpload[uploadEntryShown].type.startsWith("video/")) ? Object.assign(document.createElement("video"), {autoplay: true, muted: true}) : new Image();
    containerDiv.append(firstImage);
    let promiseResult = false;
    while (!promiseResult) { // Look for a valid image
      promiseResult = await new Promise<boolean>(async (res) => {
        firstImage.onload = () => res(true);
        firstImage.onplay = () => res(true);
        firstImage.onerror = () => res(false);
          if (!cursor) { // Get the files in the `uploadEntryShown` array
            firstImage.src = URL.createObjectURL(currentUpload[uploadEntryShown]);
            uploadEntryShown++;
            if (uploadEntryShown === currentUpload.length) uploadEntryShown = 0;
          } else { // Get the value of the current cursor, and load the next one.
            const value = cursor.value;
            cursorIds.push(cursor.key);
            await initCursor(IDBKeyRange.lowerBound(cursor.key));
            firstImage.src = URL.createObjectURL(value.data);
          }
          if (firstImage instanceof HTMLVideoElement) firstImage.play();
      });
    }
    await new Promise<void>(res => setTimeout(res, 50));
    firstImage.style.opacity = "1";
    if (firstImage instanceof HTMLVideoElement) firstImage.play();
    if (cursor) firstImage.onclick = async () => { // If clicked, ask the user if they want to delete the image. The loop will be paused until the user has chosen what to do with the current image.
      pauseLoop = true;
      updateMouseCursor(false); // It might be a good idea to show the cursor
      topDialog.style.opacity = "1";
      await new Promise<void>(res => {waitDeletePromise = res});
      updateMouseCursor((document.getElementById("hideCursor") as HTMLInputElement).checked);
      pauseLoop = false;
    }
    if (prevItem) prevItem.style.opacity = "0"; // Start opacity transition
    await new Promise<void>(res => {
      waitPromise = () => { // The user can speed up this process by pressing the keyboard arrow keys. In this case, we'll delete the normal transition so that it immediately completes.
        firstImage.style.transition = "none";
        setTimeout(() => {
          firstImage.style.transition = "";
          res();
        }, 15);
      }
      setTimeout(res, +(document.getElementById("transition") as HTMLInputElement).value)
  });
    if (prevItem) { // Remove the previous image
      URL.revokeObjectURL(prevItem.src);
      prevItem.remove();
    }
    await new Promise<void>(res => { // Now wait the necessary time for the next image
      waitPromise = res;
      setTimeout(res, firstImage instanceof HTMLVideoElement && (document.getElementById("maxVideoLength") as HTMLInputElement).checked ? firstImage.duration * 1000 : +(document.getElementById("interval") as HTMLInputElement).value);
  });
  /**
   * A function that blocks the loop until the `pauseLoop` boolean is set to false.
   */
    async function waitIfPaused() {
      if (pauseLoop) await new Promise<void>(res => {
        setTimeout(async () => res(await waitIfPaused()), 250);
      });
    }
    await waitIfPaused();
    start(true);
  }

  window.addEventListener("fullscreenchange", async () => { // If the user exited from fullscreen mode, hide the containerDiv. Otherwise start the loop
    if (!document.fullscreenElement) {
      containerDiv.style.top = "100vh"; // Add a slider transition
      await new Promise(res => setTimeout(res, 210));
      if (!document.fullscreenElement) containerDiv.style.display = "none";
    } else start(false);
  })

  // Save the settings in the LocalStorage
  for (const [element, storage] of [ // As a key the ID of the input, as a value how they'll be saved in the LocalStorage
    ["interval", "ImageInterval"],
    ["transition", "Transition"],
    ["cssFilter", "Filter"],
    ["pickFolder", "DefaultFolder"],
    ["saveInStorage", "storageSave"],
    ["hideCursor", "HideCursor"],
    ["maxVideoLength", "TotalVideo"]
  ]) {
    const dom = document.getElementById(element) as HTMLInputElement;
    const storageEntry = localStorage.getItem(`CustomScreensaver-${storage}`);
    if (dom.type === "checkbox") {
      dom.addEventListener("change", () => localStorage.setItem(`CustomScreensaver-${storage}`, dom.checked ? "a" : "b"));
      if (storageEntry) dom.checked = storageEntry === "a";
    } else {
      dom.addEventListener("change", () => localStorage.setItem(`CustomScreensaver-${storage}`, dom.value));
      if (storageEntry) dom.value = storageEntry;
    }
  }

  /**
   * The dialog that permits the user to delete the current image
   */
  const topDialog = document.getElementById("imgDeleteDialog") as HTMLDivElement;
  document.getElementById("deleteImg")?.addEventListener("click", () => { // The user wants to delete the currently displayed image
    topDialog.style.opacity = "0";
    const id = cursorIds.pop();
    id && db.transaction(["UploadedFiles"], "readwrite").objectStore("UploadedFiles").delete(id);
    waitPromise && waitPromise();
    waitDeletePromise();
  });
  document.getElementById("keepImg")?.addEventListener("click", () => { // The user wants to keep the image
    topDialog.style.opacity = "0";
    waitDeletePromise();
  })
  window.addEventListener("keyup", async (e) => { // Check if it's an arrow key
    if (e.key === "ArrowLeft" && waitPromise) { // Try going to the previous image. Kinda buggy
      cursorIds.pop();
      if (cursorIds.length !== 0) {
        await initCursor(IDBKeyRange.lowerBound(cursorIds.pop()));
        waitPromise && waitPromise();
      }
    } else if (e.key === "ArrowRight" && waitPromise) { // Go to the next image (or end the transition). Way more stable than the arrow left.
      waitPromise && waitPromise();
    }
  })
})()
