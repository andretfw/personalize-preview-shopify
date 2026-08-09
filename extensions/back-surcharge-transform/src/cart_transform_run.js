// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

const ATTRIBUTE_MAP = [
  ["personalized", "_Personalized"],
  ["designConfirmed", "_Design confirmed"],
  ["personalizedSides", "_Personalized sides"],
  ["frontArtworkPreview", "_Front artwork preview"],
  ["frontArtworkFile", "_Front artwork file"],
  ["frontApprovedProof", "_Front approved proof"],
  ["frontPrintQuality", "_Front print quality"],
  ["frontPrintSize", "_Front print size"],
  ["frontArtworkPlacement", "_Front artwork placement"],
  ["frontText", "Front text"],
  ["backArtworkPreview", "_Back artwork preview"],
  ["backArtworkFile", "_Back artwork file"],
  ["backApprovedProof", "_Back approved proof"],
  ["backPrintQuality", "_Back print quality"],
  ["backPrintSize", "_Back print size"],
  ["backArtworkPlacement", "_Back artwork placement"],
  ["backText", "Back text"],
];

function attributeValue(attribute) {
  return typeof attribute?.value === "string" ? attribute.value : "";
}

function backIsPersonalized(line) {
  const sides = attributeValue(line.personalizedSides)
    .split(",")
    .map((side) => side.trim().toLowerCase());

  return (
    sides.includes("back") ||
    Boolean(
      attributeValue(line.backArtworkPreview) ||
        attributeValue(line.backApprovedProof) ||
        attributeValue(line.backArtworkPlacement) ||
        attributeValue(line.backText),
    )
  );
}

function personalizationAttributes(line) {
  return ATTRIBUTE_MAP.flatMap(([field, key]) => {
    const value = attributeValue(line[field]);
    return value ? [{ key, value }] : [];
  });
}

function buildExpandOperation(line, presentmentCurrencyRate) {
  const merchandise = line.merchandise;
  if (merchandise?.__typename !== "ProductVariant") return null;
  if (attributeValue(line.personalized) !== "Yes") return null;
  if (attributeValue(line.designConfirmed) !== "Yes") return null;
  if (!backIsPersonalized(line)) return null;

  const surcharge = Number(merchandise.product?.backSurcharge?.value || 0);
  const feeVariantId = String(merchandise.product?.backFeeVariantId?.value || "");
  if (!Number.isFinite(surcharge) || surcharge <= 0) return null;
  if (!feeVariantId.startsWith("gid://shopify/ProductVariant/")) return null;

  const rate = Number(presentmentCurrencyRate || 1);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const basePrice = String(line.cost.amountPerQuantity.amount);
  const feePrice = (surcharge * rate).toFixed(2);

  return {
    cartLineId: line.id,
    title: merchandise.product?.title,
    expandedCartItems: [
      {
        merchandiseId: merchandise.id,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: basePrice,
            },
          },
        },
        attributes: personalizationAttributes(line),
      },
      {
        merchandiseId: feeVariantId,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: feePrice,
            },
          },
        },
        attributes: [
          { key: "Add-on", value: "Back side personalization" },
          { key: "_Personalization add-on", value: "Back side" },
        ],
      },
    ],
  };
}

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const operations = input.cart.lines.flatMap((line) => {
    const operation = buildExpandOperation(line, input.presentmentCurrencyRate);
    return operation ? [{ lineExpand: operation }] : [];
  });

  return { operations };
}
