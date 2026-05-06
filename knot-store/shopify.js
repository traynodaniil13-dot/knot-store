/**
 * KNØT — Shopify Storefront API
 * ─────────────────────────────────────────────────────────────
 * Versión corregida. Bugs resueltos:
 *
 *  1. sortKey 'COLLECTION_DEFAULT' → no existe en Storefront API → cambiado a 'BEST_SELLING'
 *  2. getOrCreateCart() ahora persiste TAMBIÉN checkoutUrl en localStorage
 *  3. updateCartUI() sincroniza el badge y el href del carrito en el header
 *     en cualquier página que incluya este script
 *  4. addToCart() devuelve el cart completo con checkoutUrl actualizado
 *  5. El botón del header (#cart-btn) se enlaza dinámicamente al checkout
 * ─────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

var SHOPIFY_CONFIG = {
  domain:     'knot-181139.myshopify.com',
  token:      '1dcf901d3032448aea02f9bc50d50d0a',
  apiVersion: '2024-01',
};

var STOREFRONT_URL = 'https://' + SHOPIFY_CONFIG.domain +
                     '/api/' + SHOPIFY_CONFIG.apiVersion + '/graphql.json';

// localStorage keys
var CART_ID_KEY  = 'knot_cart_id';
var CART_URL_KEY = 'knot_cart_url';
var CART_QTY_KEY = 'knot_cart_qty';


// ─────────────────────────────────────────────────────────────
// Cliente GraphQL base
// ─────────────────────────────────────────────────────────────

/**
 * Ejecuta cualquier query o mutation contra la Storefront API.
 * @param {string} query
 * @param {object} variables
 * @returns {Promise<object>} data
 */
function shopifyFetch(query, variables) {
  variables = variables || {};

  return fetch(STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type':                      'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_CONFIG.token,
    },
    body: JSON.stringify({ query: query, variables: variables }),
  })
  .then(function(res) {
    if (!res.ok) {
      throw new Error('[KNOT] HTTP ' + res.status + ': ' + res.statusText);
    }
    return res.json();
  })
  .then(function(json) {
    if (json.errors && json.errors.length) {
      var msg = json.errors.map(function(e) { return e.message; }).join(' | ');
      throw new Error('[KNOT] GraphQL error: ' + msg);
    }
    return json.data;
  });
}


// ─────────────────────────────────────────────────────────────
// UI del carrito — sincronización global
// ─────────────────────────────────────────────────────────────

/**
 * Actualiza el badge de cantidad y el href del botón del carrito
 * en la página actual. Funciona en index, catalog y product.
 *
 * @param {number} qty         - Total de artículos en el carrito
 * @param {string} checkoutUrl - URL de checkout de Shopify
 */
function updateCartUI(qty, checkoutUrl) {
  // Persistir en localStorage
  if (qty !== undefined)      localStorage.setItem(CART_QTY_KEY, String(qty));
  if (checkoutUrl)            localStorage.setItem(CART_URL_KEY, checkoutUrl);

  var storedQty = parseInt(localStorage.getItem(CART_QTY_KEY) || '0', 10);
  var storedUrl = localStorage.getItem(CART_URL_KEY) || '#';

  // Badge (puede haber varios en la página si el header se repite)
  var badges = document.querySelectorAll('#cart-count, .cart-badge');
  badges.forEach(function(badge) {
    if (storedQty > 0) {
      badge.textContent = storedQty > 99 ? '99+' : String(storedQty);
      badge.hidden = false;
      badge.removeAttribute('hidden');
    } else {
      badge.hidden = true;
    }
  });

  // Botón del carrito → apunta al checkout real
  var cartBtns = document.querySelectorAll('#cart-btn, .cart-btn');
  cartBtns.forEach(function(btn) {
    if (storedUrl && storedUrl !== '#') {
      btn.href = storedUrl;
      btn.setAttribute('target', '_blank');
      btn.setAttribute('rel', 'noopener');
    }
  });
}

/**
 * Restaura el estado del carrito desde localStorage al cargar la página.
 * Se llama automáticamente al incluir este script.
 */
function restoreCartUI() {
  var qty = parseInt(localStorage.getItem(CART_QTY_KEY) || '0', 10);
  var url = localStorage.getItem(CART_URL_KEY) || '';
  if (qty > 0 || url) {
    updateCartUI(qty, url);
  }
}


// ─────────────────────────────────────────────────────────────
// 1. fetchProducts()
// ─────────────────────────────────────────────────────────────

/**
 * Trae productos de la tienda.
 *
 * @param {object} opts
 * @param {number}  opts.first   - Máx. 250, default 50
 * @param {string}  opts.sortKey - BEST_SELLING | TITLE | PRICE | CREATED_AT (no COLLECTION_DEFAULT)
 * @param {boolean} opts.reverse
 * @param {string}  opts.query   - Filtro GraphQL, ej: "tag:new"
 */
function fetchProducts(opts) {
  opts = opts || {};
  var first   = opts.first   || 50;
  var sortKey = opts.sortKey || 'BEST_SELLING'; // FIX: COLLECTION_DEFAULT no existe
  var reverse = opts.reverse || false;
  var query   = opts.query   || '';

  var VARIANT_FRAGMENT = [
    'fragment VariantFields on ProductVariant {',
    '  id title availableForSale quantityAvailable',
    '  price { amount currencyCode }',
    '  compareAtPrice { amount currencyCode }',
    '  selectedOptions { name value }',
    '  image { url(transform:{maxWidth:800}) altText }',
    '}',
  ].join('\n');

  var GQL = VARIANT_FRAGMENT + '\n' + [
    'query GetProducts($first:Int! $sortKey:ProductSortKeys $reverse:Boolean $query:String) {',
    '  products(first:$first sortKey:$sortKey reverse:$reverse query:$query) {',
    '    edges {',
    '      node {',
    '        id title handle availableForSale tags',
    '        priceRange {',
    '          minVariantPrice { amount currencyCode }',
    '          maxVariantPrice { amount currencyCode }',
    '        }',
    '        compareAtPriceRange {',
    '          minVariantPrice { amount currencyCode }',
    '        }',
    '        featuredImage { url(transform:{maxWidth:600,maxHeight:750,crop:CENTER}) altText }',
    '        options { id name values }',
    '        variants(first:20) { edges { node { ...VariantFields } } }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  return shopifyFetch(GQL, {
    first:   first,
    sortKey: sortKey,
    reverse: reverse,
    query:   query,
  }).then(function(data) {
    return normalizeProducts(data.products.edges);
  });
}


// ─────────────────────────────────────────────────────────────
// 2. fetchProduct(handle)
// ─────────────────────────────────────────────────────────────

function fetchProduct(handle) {
  var VARIANT_FRAGMENT = [
    'fragment VariantFields on ProductVariant {',
    '  id title availableForSale quantityAvailable',
    '  price { amount currencyCode }',
    '  compareAtPrice { amount currencyCode }',
    '  selectedOptions { name value }',
    '  image { url(transform:{maxWidth:900}) altText }',
    '}',
  ].join('\n');

  var GQL = VARIANT_FRAGMENT + '\n' + [
    'query GetProduct($handle:String!) {',
    '  product(handle:$handle) {',
    '    id title handle descriptionHtml availableForSale tags vendor productType',
    '    priceRange {',
    '      minVariantPrice { amount currencyCode }',
    '      maxVariantPrice { amount currencyCode }',
    '    }',
    '    compareAtPriceRange { minVariantPrice { amount currencyCode } }',
    '    featuredImage { url(transform:{maxWidth:900}) altText }',
    '    images(first:10) {',
    '      edges { node { url(transform:{maxWidth:900}) altText width height } }',
    '    }',
    '    options { id name values }',
    '    variants(first:50) { edges { node { ...VariantFields } } }',
    '    metafields(identifiers:[',
    '      {namespace:"custom",key:"cram_donation_text"}',
    '      {namespace:"custom",key:"material"}',
    '      {namespace:"custom",key:"origin"}',
    '    ]) { key value }',
    '  }',
    '}',
  ].join('\n');

  return shopifyFetch(GQL, { handle: handle }).then(function(data) {
    if (!data.product) return null;
    return normalizeProduct(data.product);
  });
}


// ─────────────────────────────────────────────────────────────
// 3. createCart()
// ─────────────────────────────────────────────────────────────

function createCart() {
  var GQL = [
    'mutation {',
    '  cartCreate {',
    '    cart { id checkoutUrl totalQuantity }',
    '    userErrors { field message }',
    '  }',
    '}',
  ].join('\n');

  return shopifyFetch(GQL).then(function(data) {
    var result = data.cartCreate;
    if (result.userErrors && result.userErrors.length) {
      throw new Error('[KNOT] cartCreate: ' + result.userErrors.map(function(e) { return e.message; }).join(' | '));
    }
    return {
      id:          result.cart.id,
      checkoutUrl: result.cart.checkoutUrl,
      totalQty:    result.cart.totalQuantity || 0,
    };
  });
}


// ─────────────────────────────────────────────────────────────
// 4. addToCart(cartId, variantId, quantity)
// ─────────────────────────────────────────────────────────────

/**
 * Añade una variante al carrito. Devuelve el carrito actualizado
 * (incluyendo checkoutUrl y totalQuantity).
 *
 * @param {string} cartId
 * @param {string} variantId  - GID completo: "gid://shopify/ProductVariant/xxx"
 * @param {number} quantity
 * @returns {Promise<{id,checkoutUrl,totalQty,lines}>}
 */
function addToCart(cartId, variantId, quantity) {
  quantity = quantity || 1;

  var GQL = [
    'mutation AddToCart($cartId:ID! $lines:[CartLineInput!]!) {',
    '  cartLinesAdd(cartId:$cartId lines:$lines) {',
    '    cart {',
    '      id',
    '      checkoutUrl',
    '      totalQuantity',
    '      cost {',
    '        totalAmount    { amount currencyCode }',
    '        subtotalAmount { amount currencyCode }',
    '      }',
    '      lines(first:50) {',
    '        edges {',
    '          node {',
    '            id quantity',
    '            merchandise {',
    '              ... on ProductVariant {',
    '                id title',
    '                price { amount currencyCode }',
    '                product { title handle featuredImage { url altText } }',
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '    userErrors { field message }',
    '  }',
    '}',
  ].join('\n');

  return shopifyFetch(GQL, {
    cartId: cartId,
    lines:  [{ merchandiseId: variantId, quantity: quantity }],
  }).then(function(data) {
    var result = data.cartLinesAdd;
    if (result.userErrors && result.userErrors.length) {
      throw new Error('[KNOT] cartLinesAdd: ' + result.userErrors.map(function(e) { return e.message; }).join(' | '));
    }

    var cart = normalizeCart(result.cart);

    // FIX: actualizar UI del carrito inmediatamente tras añadir
    updateCartUI(cart.totalQty, cart.checkoutUrl);

    return cart;
  });
}


// ─────────────────────────────────────────────────────────────
// 5. getCheckoutUrl(cartId)
// ─────────────────────────────────────────────────────────────

function getCheckoutUrl(cartId) {
  // Primero intentar desde localStorage (evita un fetch innecesario)
  var cached = localStorage.getItem(CART_URL_KEY);
  if (cached) return Promise.resolve(cached);

  var GQL = [
    'query GetCart($cartId:ID!) {',
    '  cart(id:$cartId) { checkoutUrl totalQuantity }',
    '}',
  ].join('\n');

  return shopifyFetch(GQL, { cartId: cartId }).then(function(data) {
    if (!data.cart) throw new Error('[KNOT] Carrito no encontrado: ' + cartId);
    localStorage.setItem(CART_URL_KEY, data.cart.checkoutUrl);
    return data.cart.checkoutUrl;
  });
}


// ─────────────────────────────────────────────────────────────
// Cart persistence helpers
// ─────────────────────────────────────────────────────────────

/**
 * Obtiene el cartId guardado o crea uno nuevo.
 * Ahora también persiste checkoutUrl y qty.
 */
function getOrCreateCart() {
  var existing = localStorage.getItem(CART_ID_KEY);
  if (existing) return Promise.resolve(existing);

  return createCart().then(function(cart) {
    localStorage.setItem(CART_ID_KEY, cart.id);
    localStorage.setItem(CART_URL_KEY, cart.checkoutUrl);
    localStorage.setItem(CART_QTY_KEY, '0');
    return cart.id;
  });
}

/** Redirige al usuario al checkout de Shopify */
function goToCheckout() {
  var cartId = localStorage.getItem(CART_ID_KEY);
  if (!cartId) {
    // No hay carrito aún → llevar al inicio
    console.warn('[KNOT] No hay carrito activo');
    return;
  }

  getCheckoutUrl(cartId).then(function(url) {
    window.location.href = url;
  }).catch(function(err) {
    console.error('[KNOT] Error obteniendo checkout:', err);
  });
}

/** Vacía el carrito local */
function clearCart() {
  localStorage.removeItem(CART_ID_KEY);
  localStorage.removeItem(CART_URL_KEY);
  localStorage.removeItem(CART_QTY_KEY);
  updateCartUI(0, '');
}


// ─────────────────────────────────────────────────────────────
// Normalización de datos
// ─────────────────────────────────────────────────────────────

function formatPrice(priceObj) {
  if (!priceObj) return '';
  return new Intl.NumberFormat('es-ES', {
    style:                 'currency',
    currency:              priceObj.currencyCode || 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(parseFloat(priceObj.amount));
}

function calcDonation(amount) {
  return formatPrice({
    amount:       (parseFloat(amount) * 0.1).toFixed(2),
    currencyCode: 'EUR',
  });
}

function extractSizes(variants) {
  return variants.map(function(v) {
    var sizeOpt = v.selectedOptions.find(function(o) {
      return ['talla', 'size', 'taille', 'grosse', 'maat'].indexOf(o.name.toLowerCase()) > -1;
    });
    return {
      variantId: v.id,
      label:     sizeOpt ? sizeOpt.value : v.title,
      available: v.availableForSale,
      quantity:  v.quantityAvailable,
      price:     v.price,
      compareAt: v.compareAtPrice,
    };
  });
}

function normalizeProducts(edges) {
  return edges.map(function(edge) { return normalizeProduct(edge.node); });
}

function normalizeProduct(node) {
  var variants   = (node.variants && node.variants.edges || []).map(function(e) { return e.node; });
  var images     = (node.images   && node.images.edges   || []).map(function(e) { return e.node; });
  var minPrice   = node.priceRange.minVariantPrice;
  var compareAt  = node.compareAtPriceRange && node.compareAtPriceRange.minVariantPrice;
  var isOnSale   = compareAt && parseFloat(compareAt.amount) > parseFloat(minPrice.amount);
  var discountPct = isOnSale
    ? Math.round((1 - parseFloat(minPrice.amount) / parseFloat(compareAt.amount)) * 100)
    : null;

  return {
    id:            node.id,
    title:         node.title,
    handle:        node.handle,
    available:     node.availableForSale,
    tags:          node.tags || [],
    description:   node.descriptionHtml || '',
    vendor:        node.vendor || '',
    featuredImage: node.featuredImage || null,
    images:        images,
    options:       node.options || [],
    variants: variants.map(function(v) {
      return {
        id:              v.id,
        title:           v.title,
        available:       v.availableForSale,
        quantity:        v.quantityAvailable,
        price:           v.price,
        compareAt:       v.compareAtPrice,
        selectedOptions: v.selectedOptions,
        image:           v.image,
      };
    }),
    sizes:    extractSizes(variants),
    price: {
      min:       minPrice,
      max:       node.priceRange.maxVariantPrice,
      formatted: formatPrice(minPrice),
    },
    compareAtPrice: isOnSale ? {
      formatted: formatPrice(compareAt),
      raw:       compareAt,
    } : null,
    isOnSale:    isOnSale,
    discountPct: discountPct,
    donation:    calcDonation(minPrice.amount),
    metafields:  (node.metafields || []).reduce(function(acc, m) {
      if (m) acc[m.key] = m.value;
      return acc;
    }, {}),
  };
}

function normalizeCart(cart) {
  return {
    id:          cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQty:    cart.totalQuantity || 0,
    total:       cart.cost && cart.cost.totalAmount    ? formatPrice(cart.cost.totalAmount)    : null,
    subtotal:    cart.cost && cart.cost.subtotalAmount ? formatPrice(cart.cost.subtotalAmount) : null,
    lines: (cart.lines && cart.lines.edges || []).map(function(edge) {
      var node = edge.node;
      return {
        id:       node.id,
        quantity: node.quantity,
        variant: {
          id:    node.merchandise.id,
          title: node.merchandise.title,
          price: formatPrice(node.merchandise.price),
        },
        product: {
          title:  node.merchandise.product.title,
          handle: node.merchandise.product.handle,
          image:  node.merchandise.product.featuredImage,
        },
      };
    }),
  };
}


// ─────────────────────────────────────────────────────────────
// Init — restaurar carrito al cargar la página
// ─────────────────────────────────────────────────────────────

// Se ejecuta cuando el DOM está listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreCartUI);
} else {
  restoreCartUI();
}


// ─────────────────────────────────────────────────────────────
// API pública — window.KnotShopify
// ─────────────────────────────────────────────────────────────

window.KnotShopify = {
  // Productos
  fetchProducts:    fetchProducts,
  fetchProduct:     fetchProduct,

  // Carrito
  createCart:       createCart,
  addToCart:        addToCart,
  getCheckoutUrl:   getCheckoutUrl,
  getOrCreateCart:  getOrCreateCart,
  goToCheckout:     goToCheckout,
  clearCart:        clearCart,

  // UI
  updateCartUI:     updateCartUI,
  restoreCartUI:    restoreCartUI,

  // Formateo
  formatPrice:      formatPrice,
  calcDonation:     calcDonation,

  // Config (lectura)
  config: SHOPIFY_CONFIG,
};
