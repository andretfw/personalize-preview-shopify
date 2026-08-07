(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  const initializedCustomizers = new WeakSet();

  const allowedFileTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);

  const allowedFileExtensions = /\.(png|jpe?g|webp)$/i;
  const maximumFileSize = 15 * 1024 * 1024;

  const clamp = (value, minimum, maximum) =>
    Math.min(Math.max(value, minimum), maximum);

  const round = (value) =>
    Math.round(value * 10) / 10;

  const sleep = (milliseconds) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });


  /* =========================================================
     PRODUCT FORM
     ========================================================= */

  function findProductForm(customizer) {
    const closestForm = customizer.closest(
      'form[action*="/cart/add"]',
    );

    if (closestForm) {
      return closestForm;
    }

    const section =
      customizer.closest('[id^="shopify-section-"]') ||
      customizer.closest(".shopify-section") ||
      document;

    const forms = Array.from(
      section.querySelectorAll(
        'form[action*="/cart/add"]',
      ),
    );

    return (
      forms.find((form) =>
        form.querySelector('[name="id"]'),
      ) ||
      forms[0] ||
      null
    );
  }


  function removeOldPropertyInputs(
    form,
    ownerId,
  ) {
    form
      .querySelectorAll(
        "[data-pp-property-owner]",
      )
      .forEach((input) => {
        if (
          input.dataset.ppPropertyOwner ===
          ownerId
        ) {
          input.remove();
        }
      });
  }


  function attachExistingInput(
    form,
    input,
    ownerId,
  ) {
    input.dataset.ppPropertyOwner =
      ownerId;

    form.appendChild(input);

    return input;
  }


  function createPropertyInput(
    form,
    name,
    ownerId,
  ) {
    const input =
      document.createElement("input");

    input.type = "hidden";
    input.name = name;
    input.value = "";

    input.dataset.ppPropertyOwner =
      ownerId;

    form.appendChild(input);

    return input;
  }


  /* =========================================================
     NETWORK HELPERS
     ========================================================= */

  function safeJson(response) {
    return response
      .json()
      .catch(() => null);
  }


  async function postProxyJson(payload) {
    const response = await fetch(
      PROXY_URL,
      {
        method: "POST",

        credentials: "same-origin",

        headers: {
          "Content-Type":
            "application/json",

          Accept: "application/json",
        },

        body: JSON.stringify(payload),
      },
    );

    const result =
      await safeJson(response);

    if (
      !response.ok ||
      !result?.ok
    ) {
      throw new Error(
        result?.error ||
          "The personalization request failed.",
      );
    }

    return result;
  }


  /* =========================================================
     SHOPIFY FILE STATUS
     ========================================================= */

  async function checkUploadedFile(
    fileId,
  ) {
    const result =
      await postProxyJson({
        action: "status",
        fileId,
      });

    return result.file;
  }


  async function waitForUploadedFile(
    file,
  ) {
    if (file?.url) {
      return file;
    }

    if (!file?.id) {
      throw new Error(
        "Shopify did not return an uploaded file ID.",
      );
    }

    let currentFile = file;

    for (
      let attempt = 0;
      attempt < 14;
      attempt += 1
    ) {
      if (currentFile?.url) {
        return currentFile;
      }

      if (
        currentFile?.status ===
        "FAILED"
      ) {
        throw new Error(
          "Shopify could not process the uploaded image.",
        );
      }

      await sleep(700);

      currentFile =
        await checkUploadedFile(
          file.id,
        );
    }

    throw new Error(
      "The image is still processing. Please click Confirm design again.",
    );
  }


  /* =========================================================
     DIRECT SHOPIFY STAGED UPLOAD
     ========================================================= */

  function getUploadMimeType(file) {
    if (
      file.type &&
      allowedFileTypes.has(file.type)
    ) {
      return file.type;
    }

    const name =
      file.name.toLowerCase();

    if (name.endsWith(".png")) {
      return "image/png";
    }

    if (
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg")
    ) {
      return "image/jpeg";
    }

    if (name.endsWith(".webp")) {
      return "image/webp";
    }

    return "";
  }


  async function uploadArtwork(file) {
    const mimeType =
      getUploadMimeType(file);

    if (!mimeType) {
      throw new Error(
        "Please upload a PNG, JPG, JPEG, or WebP image.",
      );
    }


    /*
     * STEP 1
     *
     * Ask our backend for a Shopify
     * staged-upload destination.
     *
     * This is JSON only.
     */

    const prepared =
      await postProxyJson({
        action: "prepare-upload",

        filename: file.name,

        mimeType,

        fileSize: file.size,
      });


    const upload =
      prepared?.upload;


    if (
      !upload?.url ||
      !upload?.resourceUrl
    ) {
      throw new Error(
        "Shopify did not return an upload destination.",
      );
    }


    /*
     * STEP 2
     *
     * Upload the actual image DIRECTLY
     * to Shopify's staged storage.
     *
     * The image never passes through
     * /apps/personalize-preview.
     */

    const stagedFormData =
      new FormData();


    const parameters =
      Array.isArray(
        upload.parameters,
      )
        ? upload.parameters
        : [];


    parameters.forEach(
      (parameter) => {
        if (
          parameter?.name &&
          typeof parameter.value ===
            "string"
        ) {
          stagedFormData.append(
            parameter.name,
            parameter.value,
          );
        }
      },
    );


    stagedFormData.append(
      "file",
      file,
      upload.filename ||
        file.name,
    );


    let stagedResponse;

    try {
      stagedResponse =
        await fetch(
          upload.url,
          {
            method: "POST",

            body: stagedFormData,
          },
        );
    } catch (error) {
      console.error(
        "Direct Shopify upload network failure:",
        error,
      );

      throw new Error(
        "The artwork could not be sent to Shopify.",
      );
    }


    if (!stagedResponse.ok) {
      const responseText =
        await stagedResponse
          .text()
          .catch(() => "");

      console.error(
        "Direct Shopify staged upload failed:",
        stagedResponse.status,
        responseText,
      );

      throw new Error(
        "Shopify could not receive the artwork upload.",
      );
    }


    /*
     * STEP 3
     *
     * The image is now in Shopify's
     * staged storage.
     *
     * Ask our backend to create
     * the permanent Shopify file.
     */

    const completed =
      await postProxyJson({
        action: "complete-upload",

        resourceUrl:
          upload.resourceUrl,

        filename:
          upload.filename ||
          file.name,
      });


    if (!completed?.file?.id) {
      throw new Error(
        "Shopify did not create the artwork file.",
      );
    }


    /*
     * STEP 4
     *
     * Shopify processes MediaImages
     * asynchronously.
     *
     * Poll until the CDN URL exists.
     */

    return waitForUploadedFile(
      completed.file,
    );
  }


  /* =========================================================
     INITIALIZE CUSTOMIZER
     ========================================================= */

  function initializeCustomizer(
    customizer,
  ) {
    if (
      initializedCustomizers.has(
        customizer,
      )
    ) {
      return;
    }

    initializedCustomizers.add(
      customizer,
    );


    /* =======================================================
       STUDIO MODAL
       ======================================================= */

    const studio =
      customizer.querySelector(
        "[data-pp-studio]",
      );

    const openStudioButton =
      customizer.querySelector(
        "[data-pp-open-studio]",
      );

    const closeStudioButtons =
      customizer.querySelectorAll(
        "[data-pp-close-studio]",
      );


    const studioOriginalParent =
      studio?.parentNode || null;

    const studioOriginalNextSibling =
      studio?.nextSibling || null;


    const oldHtmlOverflow =
      document.documentElement.style
        .overflow;

    const oldBodyOverflow =
      document.body.style.overflow;


    function copyPrintAreaVariablesToStudio() {
      if (!studio) {
        return;
      }

      const styles =
        window.getComputedStyle(
          customizer,
        );

      [
        "--pp-print-left",
        "--pp-print-top",
        "--pp-print-width",
        "--pp-print-height",
      ].forEach((property) => {
        studio.style.setProperty(
          property,

          styles
            .getPropertyValue(property)
            .trim(),
        );
      });
    }


    function openStudio() {
      if (!studio) {
        return;
      }

      copyPrintAreaVariablesToStudio();

      document.body.appendChild(
        studio,
      );

      studio.hidden = false;

      document.documentElement.style.overflow =
        "hidden";

      document.body.style.overflow =
        "hidden";
    }


    function closeStudio() {
      if (!studio) {
        return;
      }

      studio.hidden = true;

      document.documentElement.style.overflow =
        oldHtmlOverflow;

      document.body.style.overflow =
        oldBodyOverflow;


      if (studioOriginalParent) {
        if (
          studioOriginalNextSibling &&
          studioOriginalNextSibling
            .parentNode ===
            studioOriginalParent
        ) {
          studioOriginalParent.insertBefore(
            studio,
            studioOriginalNextSibling,
          );
        } else {
          studioOriginalParent.appendChild(
            studio,
          );
        }
      }
    }


    openStudioButton?.addEventListener(
      "click",
      openStudio,
    );


    closeStudioButtons.forEach(
      (button) => {
        button.addEventListener(
          "click",
          closeStudio,
        );
      },
    );


    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          studio &&
          !studio.hidden
        ) {
          closeStudio();
        }
      },
    );


    /* =======================================================
       ELEMENTS
       ======================================================= */

    const blockId =
      customizer.dataset.blockId ||
      Math.random()
        .toString(36)
        .slice(2, 10);


    const fileInput =
      customizer.querySelector(
        "[data-pp-file]",
      );

    const artwork =
      customizer.querySelector(
        "[data-pp-artwork]",
      );

    const printArea =
      customizer.querySelector(
        "[data-pp-print-area]",
      );

    const emptyState =
      customizer.querySelector(
        "[data-pp-empty-state]",
      );

    const fileName =
      customizer.querySelector(
        "[data-pp-file-name]",
      );

    const editControls =
      customizer.querySelector(
        "[data-pp-edit-controls]",
      );

    const scaleInput =
      customizer.querySelector(
        "[data-pp-scale]",
      );

    const centerButton =
      customizer.querySelector(
        "[data-pp-center]",
      );

    const resetButton =
      customizer.querySelector(
        "[data-pp-reset]",
      );

    const textLayer =
      customizer.querySelector(
        "[data-pp-text-layer]",
      );

    const textInput =
      customizer.querySelector(
        "[data-pp-text-input]",
      );

    const fontSelect =
      customizer.querySelector(
        "[data-pp-font]",
      );

    const textColorInput =
      customizer.querySelector(
        "[data-pp-text-color]",
      );

    const textEditControls =
      customizer.querySelector(
        "[data-pp-text-edit-controls]",
      );

    const textSizeInput =
      customizer.querySelector(
        "[data-pp-text-size]",
      );

    const centerTextButton =
      customizer.querySelector(
        "[data-pp-center-text]",
      );

    const removeTextButton =
      customizer.querySelector(
        "[data-pp-remove-text]",
      );

    const confirmButton =
      customizer.querySelector(
        "[data-pp-confirm]",
      );

    const confirmedState =
      customizer.querySelector(
        "[data-pp-confirmed-state]",
      );

    const editDesignButton =
      customizer.querySelector(
        "[data-pp-edit-design]",
      );

    const continueButton =
      customizer.querySelector(
        "[data-pp-continue]",
      );

    const errorMessage =
      customizer.querySelector(
        "[data-pp-error]",
      );

    const previewHelp =
      customizer.querySelector(
        "[data-pp-preview-help]",
      );

    const placementInput =
      customizer.querySelector(
        "[data-pp-placement]",
      );

    const textDetailsInput =
      customizer.querySelector(
        "[data-pp-text-details]",
      );

    const customizedInput =
      customizer.querySelector(
        "[data-pp-customized]",
      );

    const confirmedInput =
      customizer.querySelector(
        "[data-pp-confirmed]",
      );


    if (
      !fileInput ||
      !artwork ||
      !printArea ||
      !scaleInput ||
      !placementInput ||
      !textLayer ||
      !textInput ||
      !fontSelect ||
      !textColorInput ||
      !textSizeInput ||
      !textDetailsInput ||
      !customizedInput ||
      !confirmedInput
    ) {
      return;
    }


    const uploadIsRequired =
      fileInput.dataset.required ===
      "true";


    /* =======================================================
       SHOPIFY PRODUCT FORM
       ======================================================= */

    const productForm =
      findProductForm(customizer);


    if (!productForm) {
      if (errorMessage) {
        errorMessage.textContent =
          "The Shopify product form could not be found.";

        errorMessage.hidden = false;
      }

      return;
    }


    removeOldPropertyInputs(
      productForm,
      blockId,
    );


    fileInput.removeAttribute(
      "name",
    );

    textInput.removeAttribute(
      "name",
    );


    const formPlacementInput =
      attachExistingInput(
        productForm,
        placementInput,
        blockId,
      );


    const formTextDetailsInput =
      attachExistingInput(
        productForm,
        textDetailsInput,
        blockId,
      );


    const formCustomizedInput =
      attachExistingInput(
        productForm,
        customizedInput,
        blockId,
      );


    const formConfirmedInput =
      attachExistingInput(
        productForm,
        confirmedInput,
        blockId,
      );


    const artworkUrlInput =
      createPropertyInput(
        productForm,

        "properties[_Artwork preview]",

        blockId,
      );


    const artworkNameInput =
      createPropertyInput(
        productForm,

        "properties[_Artwork file]",

        blockId,
      );


    const customTextInput =
      createPropertyInput(
        productForm,

        "properties[Custom text]",

        blockId,
      );


    const shopifyFileIdInput =
      createPropertyInput(
        productForm,

        "properties[_Shopify file ID]",

        blockId,
      );


    /* =======================================================
       STATE
       ======================================================= */

    let objectUrl = null;


    const state = {
      hasArtwork: false,

      sourceFile: null,

      sourceFileKey: "",

      artworkFileName: "",

      artworkUrl: "",

      shopifyFileId: "",

      uploadedFileKey: "",


      artworkX: 50,

      artworkY: 50,

      artworkScale: 1,

      artworkBaseWidth: 70,


      artworkPointerId: null,

      artworkPointerStartX: 0,

      artworkPointerStartY: 0,

      artworkStartX: 50,

      artworkStartY: 50,


      hasText: false,

      text: "",

      textX: 50,

      textY: 75,

      textSize: 30,

      textFont:
        fontSelect.value,

      textColor:
        textColorInput.value,


      textPointerId: null,

      textPointerStartX: 0,

      textPointerStartY: 0,

      textStartX: 50,

      textStartY: 75,


      confirmed: false,

      confirming: false,
    };


    const editableControls = [
      fileInput,
      scaleInput,
      centerButton,
      resetButton,
      textInput,
      fontSelect,
      textColorInput,
      textSizeInput,
      centerTextButton,
      removeTextButton,
    ].filter(Boolean);


    const originalConfirmText =
      confirmButton?.textContent
        ?.trim() ||
      "Confirm design";


    /* =======================================================
       UI HELPERS
       ======================================================= */

    function hasCustomization() {
      return (
        state.hasArtwork ||
        state.hasText
      );
    }


    function createFileKey(file) {
      return [
        file.name,
        file.size,
        file.type,
        file.lastModified,
      ].join(":");
    }


    function showError(message) {
      if (!errorMessage) {
        return;
      }

      errorMessage.textContent =
        message;

      errorMessage.hidden = false;
    }


    function clearError() {
      if (!errorMessage) {
        return;
      }

      errorMessage.textContent = "";

      errorMessage.hidden = true;
    }


    function setConfirming(
      confirming,
    ) {
      state.confirming =
        confirming;


      if (!confirmButton) {
        return;
      }


      confirmButton.disabled =
        confirming;


      confirmButton.textContent =
        confirming
          ? "Saving artwork…"
          : originalConfirmText;
    }


    function setConfirmed(
      confirmed,
    ) {
      state.confirmed =
        confirmed;


      formConfirmedInput.value =
        confirmed
          ? "Yes"
          : "No";


      customizer.classList.toggle(
        "pp-is-confirmed",
        confirmed,
      );


      studio?.classList.toggle(
        "pp-is-confirmed",
        confirmed,
      );


      editableControls.forEach(
        (control) => {
          control.disabled =
            confirmed;
        },
      );


      if (confirmButton) {
        confirmButton.hidden =
          confirmed;
      }


      if (confirmedState) {
        confirmedState.hidden =
          !confirmed;
      }
    }


    function invalidateConfirmation() {
      if (state.confirmed) {
        setConfirmed(false);
      }
    }


    function updateSharedInterface() {
      printArea.classList.toggle(
        "pp-has-artwork",
        state.hasArtwork,
      );


      printArea.classList.toggle(
        "pp-has-text",
        state.hasText,
      );


      const customized =
        hasCustomization();


      if (emptyState) {
        emptyState.hidden =
          customized;
      }


      if (previewHelp) {
        previewHelp.hidden =
          !customized;
      }


      formCustomizedInput.value =
        customized
          ? "Yes"
          : "No";
    }


    /* =======================================================
       SHOPIFY PROPERTIES
       ======================================================= */

    function updateArtworkProperty() {
      if (!state.hasArtwork) {
        formPlacementInput.value = "";

        artworkUrlInput.value = "";

        artworkNameInput.value = "";

        shopifyFileIdInput.value = "";

        return;
      }


      const styles =
        window.getComputedStyle(
          customizer,
        );


      formPlacementInput.value =
        JSON.stringify({
          x: round(
            state.artworkX,
          ),

          y: round(
            state.artworkY,
          ),

          scale: round(
            state.artworkScale,
          ),

          area: {
            left: styles
              .getPropertyValue(
                "--pp-print-left",
              )
              .trim(),

            top: styles
              .getPropertyValue(
                "--pp-print-top",
              )
              .trim(),

            width: styles
              .getPropertyValue(
                "--pp-print-width",
              )
              .trim(),

            height: styles
              .getPropertyValue(
                "--pp-print-height",
              )
              .trim(),
          },
        });


      artworkUrlInput.value =
        state.artworkUrl;


      artworkNameInput.value =
        state.artworkFileName;


      shopifyFileIdInput.value =
        state.shopifyFileId;
    }


    function updateTextProperty() {
      customTextInput.value =
        state.hasText
          ? state.text
          : "";


      if (!state.hasText) {
        formTextDetailsInput.value =
          "";

        return;
      }


      formTextDetailsInput.value =
        JSON.stringify({
          x: round(
            state.textX,
          ),

          y: round(
            state.textY,
          ),

          size:
            state.textSize,

          font:
            state.textFont,

          color:
            state.textColor,
        });
    }


    function updateAllProperties() {
      updateArtworkProperty();

      updateTextProperty();

      updateSharedInterface();
    }


    /* =======================================================
       ARTWORK RENDERING
       ======================================================= */

    function renderArtwork() {
      artwork.style.setProperty(
        "--pp-artwork-x",
        `${state.artworkX}%`,
      );


      artwork.style.setProperty(
        "--pp-artwork-y",
        `${state.artworkY}%`,
      );


      artwork.style.setProperty(
        "--pp-artwork-scale",
        String(
          state.artworkScale,
        ),
      );


      artwork.style.setProperty(
        "--pp-artwork-width",
        `${state.artworkBaseWidth}%`,
      );


      updateArtworkProperty();

      updateSharedInterface();
    }


    /* =======================================================
       TEXT RENDERING
       ======================================================= */

    function renderText() {
      textLayer.textContent =
        state.text;


      textLayer.hidden =
        !state.hasText;


      textLayer.style.setProperty(
        "--pp-text-x",
        `${state.textX}%`,
      );


      textLayer.style.setProperty(
        "--pp-text-y",
        `${state.textY}%`,
      );


      textLayer.style.fontSize =
        `${state.textSize}px`;


      textLayer.style.fontFamily =
        state.textFont;


      textLayer.style.color =
        state.textColor;


      if (textEditControls) {
        textEditControls.hidden =
          !state.hasText;
      }


      updateTextProperty();

      updateSharedInterface();
    }


    /* =======================================================
       INITIAL ARTWORK SIZE
       ======================================================= */

    function calculateInitialArtworkSize() {
      const rectangle =
        printArea.getBoundingClientRect();


      if (
        !rectangle.width ||
        !rectangle.height ||
        !artwork.naturalWidth ||
        !artwork.naturalHeight
      ) {
        state.artworkBaseWidth =
          70;

        return;
      }


      const artworkRatio =
        artwork.naturalWidth /
        artwork.naturalHeight;


      const areaRatio =
        rectangle.width /
        rectangle.height;


      if (
        artworkRatio >=
        areaRatio
      ) {
        state.artworkBaseWidth =
          72;
      } else {
        const fittedWidth =
          (72 *
            rectangle.height *
            artworkRatio) /
          rectangle.width;


        state.artworkBaseWidth =
          clamp(
            fittedWidth,
            22,
            72,
          );
      }
    }


    /* =======================================================
       REMOVE ARTWORK
       ======================================================= */

    function removeArtwork(
      clearFileInput = true,
    ) {
      invalidateConfirmation();


      if (objectUrl) {
        URL.revokeObjectURL(
          objectUrl,
        );

        objectUrl = null;
      }


      state.hasArtwork = false;

      state.sourceFile = null;

      state.sourceFileKey = "";

      state.artworkFileName = "";

      state.artworkUrl = "";

      state.shopifyFileId = "";

      state.uploadedFileKey = "";


      state.artworkX = 50;

      state.artworkY = 50;

      state.artworkScale = 1;

      state.artworkBaseWidth = 70;


      artwork.hidden = true;

      artwork.removeAttribute(
        "src",
      );


      if (editControls) {
        editControls.hidden =
          true;
      }


      if (fileName) {
        fileName.textContent =
          "No file selected";
      }


      scaleInput.value = "100";


      if (clearFileInput) {
        fileInput.value = "";
      }


      clearError();

      renderArtwork();
    }


    /* =======================================================
       REMOVE TEXT
       ======================================================= */

    function removeText() {
      invalidateConfirmation();


      state.hasText = false;

      state.text = "";

      state.textX = 50;

      state.textY = 75;

      state.textSize = 30;


      textInput.value = "";

      textSizeInput.value =
        "30";


      clearError();

      renderText();
    }


    /* =======================================================
       FILE VALIDATION
       ======================================================= */

    function validateFile(file) {
      const validType =
        allowedFileTypes.has(
          file.type,
        );


      const validExtension =
        allowedFileExtensions.test(
          file.name,
        );


      if (
        !validType &&
        !validExtension
      ) {
        return "Please upload a PNG, JPG, JPEG, or WebP image.";
      }


      if (file.size <= 0) {
        return "The uploaded image is empty.";
      }


      if (
        file.size >
        maximumFileSize
      ) {
        return "The image is too large. Please choose a file under 15 MB.";
      }


      return "";
    }


    /* =======================================================
       FILE INPUT
       ======================================================= */

    fileInput.addEventListener(
      "change",
      () => {
        invalidateConfirmation();

        clearError();


        const file =
          fileInput.files?.[0];


        if (!file) {
          removeArtwork(false);

          return;
        }


        const validationError =
          validateFile(file);


        if (validationError) {
          removeArtwork();

          showError(
            validationError,
          );

          return;
        }


        if (objectUrl) {
          URL.revokeObjectURL(
            objectUrl,
          );
        }


        objectUrl =
          URL.createObjectURL(
            file,
          );


        state.sourceFile =
          file;


        state.sourceFileKey =
          createFileKey(file);


        state.artworkFileName =
          file.name;


        state.artworkUrl = "";

        state.shopifyFileId = "";

        state.uploadedFileKey = "";


        state.artworkX = 50;

        state.artworkY = 50;

        state.artworkScale = 1;


        artwork.hidden = true;


        artwork.onload = () => {
          state.hasArtwork =
            true;


          calculateInitialArtworkSize();


          artwork.hidden = false;


          if (editControls) {
            editControls.hidden =
              false;
          }


          if (fileName) {
            fileName.textContent =
              file.name;
          }


          scaleInput.value =
            "100";


          renderArtwork();
        };


        artwork.onerror = () => {
          removeArtwork();

          showError(
            "This image could not be loaded. Please try another file.",
          );
        };


        artwork.src =
          objectUrl;
      },
    );


    /* =======================================================
       ARTWORK SCALE
       ======================================================= */

    scaleInput.addEventListener(
      "input",
      () => {
        invalidateConfirmation();


        state.artworkScale =
          Number(
            scaleInput.value,
          ) / 100;


        renderArtwork();
      },
    );


    /* =======================================================
       CENTER ARTWORK
       ======================================================= */

    centerButton?.addEventListener(
      "click",
      () => {
        invalidateConfirmation();


        state.artworkX = 50;

        state.artworkY = 50;


        renderArtwork();
      },
    );


    /* =======================================================
       RESET ARTWORK
       ======================================================= */

    resetButton?.addEventListener(
      "click",
      () => {
        removeArtwork();
      },
    );


    /* =======================================================
       TEXT INPUT
       ======================================================= */

    textInput.addEventListener(
      "input",
      () => {
        invalidateConfirmation();


        state.text =
          textInput.value.slice(
            0,
            80,
          );


        state.hasText =
          state.text
            .trim()
            .length > 0;


        renderText();
      },
    );


    /* =======================================================
       FONT
       ======================================================= */

    fontSelect.addEventListener(
      "change",
      () => {
        invalidateConfirmation();


        state.textFont =
          fontSelect.value;


        renderText();
      },
    );


    /* =======================================================
       TEXT COLOR
       ======================================================= */

    textColorInput.addEventListener(
      "input",
      () => {
        invalidateConfirmation();


        state.textColor =
          textColorInput.value;


        renderText();
      },
    );


    /* =======================================================
       TEXT SIZE
       ======================================================= */

    textSizeInput.addEventListener(
      "input",
      () => {
        invalidateConfirmation();


        state.textSize =
          Number(
            textSizeInput.value,
          );


        renderText();
      },
    );


    /* =======================================================
       CENTER TEXT
       ======================================================= */

    centerTextButton?.addEventListener(
      "click",
      () => {
        invalidateConfirmation();


        state.textX = 50;

        state.textY = 50;


        renderText();
      },
    );


    /* =======================================================
       REMOVE TEXT
       ======================================================= */

    removeTextButton?.addEventListener(
      "click",
      () => {
        removeText();
      },
    );


    /* =======================================================
       ARTWORK DRAGGING
       ======================================================= */

    artwork.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !state.hasArtwork ||
          state.confirmed
        ) {
          return;
        }


        event.preventDefault();


        state.artworkPointerId =
          event.pointerId;


        state.artworkPointerStartX =
          event.clientX;


        state.artworkPointerStartY =
          event.clientY;


        state.artworkStartX =
          state.artworkX;


        state.artworkStartY =
          state.artworkY;


        artwork.setPointerCapture(
          event.pointerId,
        );
      },
    );


    artwork.addEventListener(
      "pointermove",
      (event) => {
        if (
          event.pointerId !==
            state.artworkPointerId ||
          state.confirmed
        ) {
          return;
        }


        event.preventDefault();


        const rectangle =
          printArea.getBoundingClientRect();


        if (
          !rectangle.width ||
          !rectangle.height
        ) {
          return;
        }


        const movementX =
          ((event.clientX -
            state.artworkPointerStartX) /
            rectangle.width) *
          100;


        const movementY =
          ((event.clientY -
            state.artworkPointerStartY) /
            rectangle.height) *
          100;


        state.artworkX =
          clamp(
            state.artworkStartX +
              movementX,
            0,
            100,
          );


        state.artworkY =
          clamp(
            state.artworkStartY +
              movementY,
            0,
            100,
          );


        renderArtwork();
      },
    );


    function stopArtworkDragging(
      event,
    ) {
      if (
        event.pointerId !==
        state.artworkPointerId
      ) {
        return;
      }


      if (
        artwork.hasPointerCapture(
          event.pointerId,
        )
      ) {
        artwork.releasePointerCapture(
          event.pointerId,
        );
      }


      state.artworkPointerId =
        null;
    }


    artwork.addEventListener(
      "pointerup",
      stopArtworkDragging,
    );


    artwork.addEventListener(
      "pointercancel",
      stopArtworkDragging,
    );


    /* =======================================================
       TEXT DRAGGING
       ======================================================= */

    textLayer.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !state.hasText ||
          state.confirmed
        ) {
          return;
        }


        event.preventDefault();


        state.textPointerId =
          event.pointerId;


        state.textPointerStartX =
          event.clientX;


        state.textPointerStartY =
          event.clientY;


        state.textStartX =
          state.textX;


        state.textStartY =
          state.textY;


        textLayer.setPointerCapture(
          event.pointerId,
        );
      },
    );


    textLayer.addEventListener(
      "pointermove",
      (event) => {
        if (
          event.pointerId !==
            state.textPointerId ||
          state.confirmed
        ) {
          return;
        }


        event.preventDefault();


        const rectangle =
          printArea.getBoundingClientRect();


        if (
          !rectangle.width ||
          !rectangle.height
        ) {
          return;
        }


        const movementX =
          ((event.clientX -
            state.textPointerStartX) /
            rectangle.width) *
          100;


        const movementY =
          ((event.clientY -
            state.textPointerStartY) /
            rectangle.height) *
          100;


        state.textX =
          clamp(
            state.textStartX +
              movementX,
            0,
            100,
          );


        state.textY =
          clamp(
            state.textStartY +
              movementY,
            0,
            100,
          );


        renderText();
      },
    );


    function stopTextDragging(
      event,
    ) {
      if (
        event.pointerId !==
        state.textPointerId
      ) {
        return;
      }


      if (
        textLayer.hasPointerCapture(
          event.pointerId,
        )
      ) {
        textLayer.releasePointerCapture(
          event.pointerId,
        );
      }


      state.textPointerId =
        null;
    }


    textLayer.addEventListener(
      "pointerup",
      stopTextDragging,
    );


    textLayer.addEventListener(
      "pointercancel",
      stopTextDragging,
    );


    /* =======================================================
       CONFIRM DESIGN
       ======================================================= */

    confirmButton?.addEventListener(
      "click",
      async () => {
        if (state.confirming) {
          return;
        }


        clearError();


        if (!hasCustomization()) {
          showError(
            "Please upload an image or add text before confirming your design.",
          );

          return;
        }


        try {
          setConfirming(true);


          if (state.hasArtwork) {
            if (!state.sourceFile) {
              throw new Error(
                "Please upload the artwork again.",
              );
            }


            const needsUpload =
              !state.artworkUrl ||
              state.uploadedFileKey !==
                state.sourceFileKey;


            if (needsUpload) {
              const uploadedFile =
                await uploadArtwork(
                  state.sourceFile,
                );


              state.artworkUrl =
                uploadedFile.url;


              state.shopifyFileId =
                uploadedFile.id;


              state.uploadedFileKey =
                state.sourceFileKey;
            }
          }


          updateAllProperties();


          setConfirmed(true);
        } catch (error) {
          console.error(
            "Personalization confirmation failed:",
            error,
          );


          showError(
            error instanceof Error
              ? error.message
              : "The design could not be confirmed.",
          );


          setConfirmed(false);
        } finally {
          setConfirming(false);
        }
      },
    );


    /* =======================================================
       EDIT CONFIRMED DESIGN
       ======================================================= */

    editDesignButton?.addEventListener(
      "click",
      () => {
        setConfirmed(false);
      },
    );


    /* =======================================================
       ADD PERSONALIZED PRODUCT TO CART
       ======================================================= */

    continueButton?.addEventListener(
      "click",
      async () => {
        clearError();


        if (!state.confirmed) {
          showError(
            "Please confirm your design before continuing.",
          );

          return;
        }


        const variantInput =
          productForm.querySelector(
            '[name="id"]',
          );


        if (
          !variantInput?.value
        ) {
          showError(
            "The selected product variant could not be found.",
          );

          return;
        }


        const quantityInput =
          productForm.querySelector(
            '[name="quantity"]',
          );


        const sellingPlanInput =
          productForm.querySelector(
            '[name="selling_plan"]',
          );


        const quantity =
          Math.max(
            1,

            Number(
              quantityInput?.value ||
                1,
            ),
          );


        updateAllProperties();


        const properties = {
          "_Artwork preview":
            state.artworkUrl || "",

          "_Artwork file":
            state.artworkFileName ||
            "",

          "Custom text":
            state.hasText
              ? state.text
              : "",

          "_Artwork placement":
            formPlacementInput.value ||
            "",

          "_Text customization":
            formTextDetailsInput.value ||
            "",

          "_Personalized":
            formCustomizedInput.value ||
            "No",

          "_Design confirmed":
            formConfirmedInput.value ||
            "No",

          "_Shopify file ID":
            state.shopifyFileId ||
            "",
        };


        Object.keys(
          properties,
        ).forEach((key) => {
          if (!properties[key]) {
            delete properties[key];
          }
        });


        const item = {
          id: Number(
            variantInput.value,
          ),

          quantity,

          properties,
        };


        if (
          sellingPlanInput?.value
        ) {
          item.selling_plan =
            Number(
              sellingPlanInput.value,
            );
        }


        try {
          continueButton.disabled =
            true;


          continueButton.textContent =
            "Adding to cart…";


          const root =
            window.Shopify?.routes
              ?.root || "/";


          const response =
            await fetch(
              `${root}cart/add.js`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },

                body: JSON.stringify({
                  items: [item],
                }),
              },
            );


          const result =
            await response.json();


          if (!response.ok) {
            throw new Error(
              result?.description ||
                result?.message ||
                "The personalized product could not be added to the cart.",
            );
          }


          window.location.href =
            `${root}cart`;
        } catch (error) {
          console.error(
            "Personalized add to cart failed:",
            error,
          );


          showError(
            error instanceof Error
              ? error.message
              : "The personalized product could not be added to the cart.",
          );


          continueButton.disabled =
            false;


          continueButton.textContent =
            "Add personalized product to cart";
        }
      },
    );


    /* =======================================================
       BLOCK NORMAL SHOPIFY ADD TO CART WHEN CUSTOMIZED
       ======================================================= */

    productForm.addEventListener(
      "submit",
      (event) => {
        clearError();


        if (
          uploadIsRequired &&
          (
            !state.hasArtwork ||
            !state.artworkUrl
          )
        ) {
          event.preventDefault();

          event.stopImmediatePropagation();


          showError(
            "Please upload and confirm your artwork before adding this product to the cart.",
          );


          openStudio();

          return;
        }


        if (hasCustomization()) {
          event.preventDefault();

          event.stopImmediatePropagation();


          if (!state.confirmed) {
            showError(
              "Please confirm your design before adding this product to the cart.",
            );
          } else {
            showError(
              "Use the Add personalized product to cart button to add this design.",
            );
          }


          openStudio();

          return;
        }


        updateAllProperties();
      },

      true,
    );


    /* =======================================================
       INITIAL RENDER
       ======================================================= */

    setConfirmed(false);

    renderArtwork();

    renderText();
  }


  /* =========================================================
     INITIALIZE ALL CUSTOMIZERS
     ========================================================= */

  function initializeAll(
    scope = document,
  ) {
    scope
      .querySelectorAll(
        CUSTOMIZER_SELECTOR,
      )
      .forEach(
        initializeCustomizer,
      );
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initializeAll();
      },
    );
  } else {
    initializeAll();
  }


  document.addEventListener(
    "shopify:section:load",
    (event) => {
      initializeAll(
        event.target,
      );
    },
  );
})();