import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// State
let novels = [];
let isAdmin = localStorage.getItem('isAdmin') === 'true';

// DOM Elements
const grid = document.getElementById('novelGrid');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const addNovelBtn = document.getElementById('addNovelBtn');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');

// Modals
const loginModal = document.getElementById('loginModal');
const novelModal = document.getElementById('novelModal');
const loginForm = document.getElementById('loginForm');
const novelForm = document.getElementById('novelForm');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  fetchNovels();
  setupEventListeners();
});

// Auth Logic
function updateAuthUI() {
  if (isAdmin) {
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    addNovelBtn.classList.remove('hidden');
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    addNovelBtn.classList.add('hidden');
  }
  renderGrid(); // re-render to show/hide admin controls on cards
}

function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById('username').value;
  const pass = document.getElementById('password').value;
  const err = document.getElementById('loginError');
  
  // Custom simple login check using env variables to hide from GitHub
  if (user === import.meta.env.VITE_ADMIN_USER && pass === import.meta.env.VITE_ADMIN_PASS) {
    isAdmin = true;
    localStorage.setItem('isAdmin', 'true');
    err.classList.add('hidden');
    closeModal(loginModal);
    loginForm.reset();
    updateAuthUI();
  } else {
    err.classList.remove('hidden');
  }
}

function handleLogout() {
  isAdmin = false;
  localStorage.removeItem('isAdmin');
  updateAuthUI();
}

// Fetch Novels
async function fetchNovels() {
  grid.innerHTML = '<div class="loading-state">Loading library...</div>';
  
  const { data, error } = await supabase
    .from('novels')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('Error fetching novels:', error);
    if(error.message.includes("JWT")) {
        // Fallback for JWT error in case key format is unexpected
        grid.innerHTML = `<div class="loading-state" style="color:var(--danger-color)">Supabase connection failed: Key might be invalid or tables not setup. Please ensure SQL is executed.</div>`;
    } else {
        grid.innerHTML = '<div class="loading-state">Failed to load novels. Ensure Supabase is configured and novels table exists.</div>';
    }
    return;
  }
  
  novels = data || [];
  renderGrid();
}

// Cover Scraping via Anilist, Jikan, Google Books
async function scrapeCoverImage(title) {
  // 1. Try AniList GraphQL (Light Novels)
  try {
    const query = `
      query ($search: String) {
        Media (search: $search, type: MANGA, format: NOVEL) {
          coverImage { large }
        }
      }
    `;
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { search: title } })
    });
    if(response.ok) {
        const json = await response.json();
        if (json.data && json.data.Media && json.data.Media.coverImage.large) {
          return json.data.Media.coverImage.large;
        }
    }
  } catch (err) { console.log('Anilist scrape failed', err); }

  // 2. Try Jikan API (MyAnimeList unofficial)
  try {
    const res = await fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(title)}&limit=1`);
    if(res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0 && json.data[0].images?.jpg?.large_image_url) {
            return json.data[0].images.jpg.large_image_url;
        }
    }
  } catch(err) { console.log('Jikan scrape failed', err); }

  // 3. Try Google Books API (Web novels / standard books)
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(title)}&maxResults=1`);
    if(res.ok) {
        const json = await res.json();
        if (json.items && json.items.length > 0 && json.items[0].volumeInfo?.imageLinks?.thumbnail) {
            let img = json.items[0].volumeInfo.imageLinks.thumbnail;
            return img.replace('http:', 'https:'); // Ensure https
        }
    }
  } catch(err) { console.log('Google Books scrape failed', err); }

  // Fallback to placeholder if all fail
  return 'https://via.placeholder.com/300x450/1e293b/FFFFFF?text=No+Cover';
}

// Handle Form Submission (Add/Edit)
async function handleNovelSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('editNovelId').value;
  const title = document.getElementById('novelTitle').value;
  const author = document.getElementById('novelAuthor').value;
  const genre = document.getElementById('novelGenre').value;
  const progress = parseInt(document.getElementById('novelProgress').value) || 0;
  const total = parseInt(document.getElementById('novelTotal').value) || null;
  const status = document.getElementById('novelStatus').value;
  let cover = document.getElementById('novelCover').value;
  
  const saveBtn = document.getElementById('saveNovelBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  if (!cover || cover.trim() === '') {
    cover = await scrapeCoverImage(title);
  }
  
  const payload = { title, author, genre, progress, total_chapters: total, status, cover_image: cover };
  
  if (id) {
    // Edit
    const { error } = await supabase.from('novels').update(payload).eq('id', id);
    if (!error) closeModal(novelModal);
  } else {
    // Insert
    const { error } = await supabase.from('novels').insert([payload]);
    if (!error) closeModal(novelModal);
  }
  
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Entry';
  fetchNovels();
}

async function updateProgress(id, change) {
  const novel = novels.find(n => n.id === id);
  if (!novel) return;
  
  let newProgress = parseInt(novel.progress || 0) + change;
  if (newProgress < 0) newProgress = 0;
  if (novel.total_chapters && newProgress > novel.total_chapters) {
    newProgress = novel.total_chapters;
  }
  
  // Optimistic update
  novel.progress = newProgress;
  renderGrid();
  
  // Persist to Supabase
  await supabase.from('novels').update({ progress: newProgress }).eq('id', id);
}

async function deleteNovel(id) {
  if(confirm("Are you sure you want to delete this entry?")) {
    await supabase.from('novels').delete().eq('id', id);
    fetchNovels();
  }
}

function editNovel(id) {
  const novel = novels.find(n => n.id === id);
  if (!novel) return;
  
  document.getElementById('novelModalTitle').textContent = 'Edit Entry';
  document.getElementById('editNovelId').value = novel.id;
  document.getElementById('novelTitle').value = novel.title;
  document.getElementById('novelAuthor').value = novel.author || '';
  document.getElementById('novelGenre').value = novel.genre || '';
  document.getElementById('novelProgress').value = novel.progress || 0;
  document.getElementById('novelTotal').value = novel.total_chapters || '';
  document.getElementById('novelStatus').value = novel.status;
  document.getElementById('novelCover').value = novel.cover_image || '';
  
  openModal(novelModal);
}

// Render Logic
function renderGrid() {
  const searchTerm = searchInput.value.toLowerCase();
  const filterVal = statusFilter.value;
  
  const filtered = novels.filter(n => {
    const matchSearch = n.title.toLowerCase().includes(searchTerm) || (n.author && n.author.toLowerCase().includes(searchTerm));
    const matchStatus = filterVal === 'All' || n.status === filterVal;
    return matchSearch && matchStatus;
  });
  
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="loading-state">No novels found.</div>';
    return;
  }
  
  grid.innerHTML = filtered.map(novel => {
    const pct = novel.total_chapters ? Math.min(100, (novel.progress / novel.total_chapters) * 100) : 0;
    const adminHtml = isAdmin ? `
      <div class="admin-actions active">
        <button class="btn secondary edit-btn" data-id="${novel.id}">Edit</button>
        <button class="btn danger delete-btn" data-id="${novel.id}">Delete</button>
      </div>
    ` : '';

    const statusClass = `status-${novel.status.split(' ')[0].toLowerCase()}`;

    return `
      <div class="novel-card">
        <div class="cover-wrapper">
          <img class="novel-cover" src="${novel.cover_image || 'https://via.placeholder.com/300x450'}" alt="${novel.title} Cover" loading="lazy" />
          <div class="novel-status ${statusClass}">${novel.status}</div>
          ${adminHtml}
        </div>
        <div class="novel-info">
          <h3 class="novel-title" title="${novel.title}">${novel.title}</h3>
          <p class="novel-author">${novel.author || 'Unknown Author'}</p>
          <div class="novel-tags">
            ${novel.genre ? novel.genre.split(',').map(g => `<span class="tag">${g.trim()}</span>`).join('') : ''}
          </div>
          <div class="progress-container">
            <div class="progress-header">
              <span>Progress</span>
              <span class="progress-controls">
                ${isAdmin ? `<button class="quick-btn decrement-btn" data-id="${novel.id}">-</button>` : ''}
                <span class="progress-text">${novel.progress} / ${novel.total_chapters || '?'}</span>
                ${isAdmin ? `<button class="quick-btn increment-btn" data-id="${novel.id}">+</button>` : ''}
              </span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach dynamic event listeners for admin
  if (isAdmin) {
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => editNovel(e.target.dataset.id));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => deleteNovel(e.target.dataset.id));
    });
    document.querySelectorAll('.increment-btn').forEach(btn => {
      btn.addEventListener('click', (e) => updateProgress(e.target.dataset.id, 1));
    });
    document.querySelectorAll('.decrement-btn').forEach(btn => {
      btn.addEventListener('click', (e) => updateProgress(e.target.dataset.id, -1));
    });
  }
}

// Event Listeners
function setupEventListeners() {
  loginBtn.addEventListener('click', () => {
    loginError.classList.add('hidden');
    openModal(loginModal);
  });
  
  logoutBtn.addEventListener('click', handleLogout);
  
  addNovelBtn.addEventListener('click', () => {
    novelForm.reset();
    document.getElementById('editNovelId').value = '';
    document.getElementById('novelModalTitle').textContent = 'Add Entry';
    openModal(novelModal);
  });
  
  loginForm.addEventListener('submit', handleLogin);
  novelForm.addEventListener('submit', handleNovelSubmit);
  
  searchInput.addEventListener('input', renderGrid);
  statusFilter.addEventListener('change', renderGrid);
  
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      closeModal(document.getElementById(e.target.dataset.modal));
    });
  });

  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      closeModal(e.target);
    }
  });
}

function openModal(modal) {
  modal.classList.add('show');
}

function closeModal(modal) {
  modal.classList.remove('show');
}
