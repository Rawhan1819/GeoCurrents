let map = L.map("map", {
  zoomControl: true,
  dragging: true,
  touchZoom: true,
  doubleClickZoom: true,
  scrollWheelZoom: true,
  boxZoom: true,
  keyboard: true
}).setView([20, 78], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

const newsDiv = document.getElementById("news");
const cache = new Map();
let currentRequest = null; // Track current request to cancel if needed

// Create fixed center marker after map container is ready
map.whenReady(() => {
  const mapContainer = document.getElementById("map");
  
  // Create the fixed center marker element
  const centerMarker = document.createElement("div");
  centerMarker.id = "center-marker";
  centerMarker.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    width: 32px;
    height: 32px;
    background-image: url('https://cdn-icons-png.flaticon.com/512/684/684908.png');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    transform: translate(-50%, -100%);
    z-index: 1000;
    pointer-events: none;
    filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3));
  `;
  
  mapContainer.appendChild(centerMarker);
  
  // Initial news fetch for current center
  const center = map.getCenter();
  reverseGeocodeAndFetch(center.lat, center.lng);
});

// Debounce function to limit API calls during map movement
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Debounced function to update news when map stops moving
const debouncedUpdate = debounce(() => {
  const center = map.getCenter();
  const lat = center.lat;
  const lon = center.lng;
  console.log(`Map center: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  reverseGeocodeAndFetch(lat, lon);
}, 1000); // Wait 1 second after user stops moving

// Update news when map movement ends
map.on("moveend", debouncedUpdate);

// Manual location search functionality
document.getElementById("getInfoBtn").addEventListener("click", getInfo);
document.getElementById("locationInput").addEventListener("keypress", function(e) {
  if (e.key === "Enter") {
    getInfo();
  }
});

function getInfo() {
  const location = document.getElementById("locationInput").value.trim();
  if (!location) {
    alert("Please enter a location.");
    return;
  }

  // Use Nominatim API for geocoding
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`)
    .then((response) => response.json())
    .then((data) => {
      if (!data || data.length === 0) {
        alert("Location not found. Please try a different search term.");
        return;
      }

      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

      // Fly to location with appropriate zoom
      const zoomLevel = getZoomLevel(data[0].type || 'city');
      map.flyTo([lat, lon], zoomLevel, {
        animate: true,
        duration: 1.5,
      });
    })
    .catch((error) => {
      console.error("Geocoding error:", error);
      alert("Error finding location. Please try again.");
    });
}

// Determine appropriate zoom level based on location type
function getZoomLevel(locationType) {
  const zoomMap = {
    'country': 6,
    'state': 8,
    'city': 10,
    'town': 12,
    'village': 14,
    'default': 10
  };
  return zoomMap[locationType] || zoomMap['default'];
}

// Reverse geocode and fetch news for given coordinates
function reverseGeocodeAndFetch(lat, lon) {
  // Cancel previous request if still pending
  if (currentRequest) {
    currentRequest.abort();
  }
  
  const controller = new AbortController();
  currentRequest = controller;
  
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`, {
    signal: controller.signal
  })
    .then((res) => res.json())
    .then((data) => {
      let location = '';
      
      // Extract meaningful location info
      if (data.address) {
        const addr = data.address;
        const parts = [];
        
        // Add city/town/village
        if (addr.city) parts.push(addr.city);
        else if (addr.town) parts.push(addr.town);
        else if (addr.village) parts.push(addr.village);
        else if (addr.suburb) parts.push(addr.suburb);
        
        // Add state/region
        if (addr.state) parts.push(addr.state);
        else if (addr.region) parts.push(addr.region);
        
        // Add country
        if (addr.country) parts.push(addr.country);
        
        location = parts.join(', ') || data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      } else {
        location = data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      }
      
      console.log(`Location: ${location}`);
      fetchNews(location);
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        console.log('Request aborted');
        return;
      }
      console.warn("Reverse geocoding failed:", error);
      fetchNews(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    })
    .finally(() => {
      currentRequest = null;
    });
}

// Fetch news for a given location
function fetchNews(location) {
  // Normalize location for caching
  const cacheKey = location.toLowerCase().trim().replace(/,\s+/g, ',');
  
  if (cache.has(cacheKey)) {
    console.log('Using cached news for:', location);
    renderArticles(cache.get(cacheKey), location);
    return;
  }
  
  setLoading(true, location);
  
  // Cancel previous request if still pending
  if (currentRequest) {
    currentRequest.abort();
  }
  
  const controller = new AbortController();
  currentRequest = controller;
  
  // Fetch news from backend
  fetch("/get_news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location }),
    signal: controller.signal
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((articles) => {
      console.log(`Received ${articles.length} articles for ${location}`);
      cache.set(cacheKey, articles);
      renderArticles(articles, location);
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        console.log('News request aborted');
        return;
      }
      console.error("Error fetching news:", error);
      newsDiv.innerHTML = `<div class="error-message">
        <p>❌ Error fetching news for ${location}</p>
        <p>Please try a different location or check your connection.</p>
      </div>`;
      setLoading(false);
    })
    .finally(() => {
      currentRequest = null;
    });
}

// Show/hide loading state
function setLoading(isLoading, location = '') {
  if (isLoading) {
    newsDiv.innerHTML = `<div class="loading-message">
      <p>🔄 Loading global news for ${location}...</p>
      <p>Searching international sources...</p>
    </div>`;
  }
}

// Render news articles
function renderArticles(articles, location) {
  setLoading(false);
  
  if (!articles || articles.length === 0 || articles.error) {
    newsDiv.innerHTML = `<div class="no-news-message">
      <p>📰 No news found for <strong>${location}</strong></p>
      <p>Try searching for a larger city or region, or drag the map to explore other areas.</p>
    </div>`;
    return;
  }

  newsDiv.innerHTML = `<div class="news-header">
    <h2>🌍 Global News for ${location}</h2>
    <p>Found ${articles.length} articles from international sources</p>
  </div>`;
  
  // Sort articles by published date (newest first)
  articles.sort((a, b) => {
    const dateA = new Date(a.publishedAt.replace(' UTC', ''));
    const dateB = new Date(b.publishedAt.replace(' UTC', ''));
    return dateB - dateA;
  });

  articles.forEach((article) => {
    const div = document.createElement("div");
    div.className = "news-item";

    // Format published date
    let dateStr = article.publishedAt || "Unknown date";
    try {
      if (dateStr !== "Unknown date" && dateStr !== "Unknown") {
        const date = new Date(dateStr.replace(' UTC', ''));
        dateStr = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    } catch (e) {
      // Keep original date string if parsing fails
    }

    // Determine source badge color
    const sourceColors = {
      'BBC News': '#bb4545',
      'Reuters World': '#ff6600',
      'Google News Global': '#4285f4',
      'Google News International': '#34a853',
      'default': '#6c757d'
    };
    
    const sourceColor = sourceColors[article.source] || sourceColors['default'];

    div.innerHTML = `
      <div class="news-source-badge" style="background-color: ${sourceColor}">
        ${article.source || 'News Source'}
      </div>
      <h3><a href="${article.url}" target="_blank" rel="noopener noreferrer">${article.title}</a></h3>
      ${article.image ? 
        `<img src="${article.image}" alt="News Image" loading="lazy" onerror="this.src='https://via.placeholder.com/400x180?text=No+Image+Available'" />` : 
        `<img src="https://via.placeholder.com/400x180?text=No+Image+Available" alt="No Image" />`
      }
      <p>${article.description}</p>
      <div class="news-footer">
        <a href="${article.url}" target="_blank" rel="noopener noreferrer" class="news-url">Read Full Article →</a>
        <small>📅 ${dateStr}</small>
      </div>
    `;
    newsDiv.appendChild(div);
  });
}

// Clear cache periodically (every 15 minutes)
setInterval(() => {
  console.log('Clearing news cache');
  cache.clear();
}, 15 * 60 * 1000);