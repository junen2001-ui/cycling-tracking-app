import { API_BASE_URL } from '../config';

async function request(pathName, options = {}) {
  const response = await fetch(`${API_BASE_URL}${pathName}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export function getRecentStartLocations() {
  return request('/api/start-locations/recent');
}

export function searchShops({ startLocation, distanceKm, startTime }) {
  return request('/api/shops/search', {
    method: 'POST',
    body: JSON.stringify({ startLocation, distanceKm, startTime }),
  });
}

export function getVisitedShops() {
  return request('/api/shops/visited');
}

export function getRoutesForShop(shopId) {
  return request(`/api/shops/${shopId}/routes`);
}

export function getSavedShops() {
  return request('/api/shops/saved');
}

export function saveShop(shopId) {
  return request(`/api/shops/${shopId}/save`, { method: 'POST' });
}

export function unsaveShop(shopId) {
  return request(`/api/shops/${shopId}/save`, { method: 'DELETE' });
}

export function createRoute({ startLocation, shopId, distanceKm, startTime }) {
  return request('/api/routes', {
    method: 'POST',
    body: JSON.stringify({ startLocation, shopId, distanceKm, startTime }),
  });
}

export function saveRouteGpx(routeId) {
  return request(`/api/routes/${routeId}/gpx`, { method: 'POST' });
}

export function shareRoute(routeId) {
  return request(`/api/routes/${routeId}/share`, { method: 'POST' });
}
