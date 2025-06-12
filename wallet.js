// == CONFIG ==
const THEEK_HAI_MINT = "8cHTywDEarRcKdBTndHgPnSGANVnGNDbmc7dDVhkpump";
const POOL_WALLET = "DkfuWLCfnbNjb3EnBCttjExGar7AK78SuNNj8xZNSNLj";
const ENTRY_FEE_TH = 10000; // 10,000 Theek Hai Coin per ticket
const LAMPORTS_PER_SOL = 1000000000;
const ALCHEMY_RPC = "https://solana-mainnet.g.alchemy.com/v2/Ed6vg1OhAsJ4gEJB0-CdDiIjvZ4DaH_g";

// ========== FIREBASE LOTTERY STATUS FUNCTIONS ==========
async function fetchCurrentLotteryStatus() {
    try {
        const doc = await db.collection("lottery").doc("current").get();
        if (!doc.exists) {
            document.getElementById('currentLotteryStatus').innerHTML = "No current lottery round found.";
            return;
        }
        const data = doc.data();
        document.getElementById('currentLotteryStatus').innerHTML = `
            <b>Current Round:</b> #${data.round}<br>
            <b>Players:</b> ${data.players || 0} / 10<br>
            <b>Pool Amount:</b> ${(data.players ? data.players * ENTRY_FEE_TH : 0).toLocaleString()} TH COIN
        `;
    } catch (err) {
        document.getElementById('currentLotteryStatus').innerHTML = "Error fetching lottery status.";
    }
}

// ========== FIREBASE USER HISTORY ==========
async function fetchAndShowHistory(walletAddress) {
    let query = await db.collection("users").doc(walletAddress).collection("history").orderBy("createdAt", "desc").get();
    let data = [];
    query.forEach(doc => data.push(doc.data()));

    if(data && data.length > 0) {
        let html = `<table class="table"><tr>
            <th>Round</th><th>Ticket #</th><th>Result</th><th>Amount Won</th><th>Withdraw</th>
        </tr>`;
        data.forEach((entry, idx) => {
            html += `<tr>
                <td>${entry.round}</td>
                <td>${entry.ticket}</td>
                <td>${entry.result}</td>
                <td>${entry.amountWon} TH COIN</td>
                <td>${entry.withdrawn ? "✅" : (entry.amountWon > 0 ? `<button onclick="withdraw('${walletAddress}','${entry.id}')">Withdraw</button>` : "-")}</td>
            </tr>`;
        });
        html += "</table>";
        document.getElementById('userHistory').innerHTML = html;
    } else {
        document.getElementById('userHistory').innerHTML = '<span class="text-muted">No entries yet.</span>';
    }
}

// ========== FIREBASE USER CREATE ==========
async function createOrUpdateUser(walletAddress) {
    const userRef = db.collection("users").doc(walletAddress);
    const docSnap = await userRef.get();
    if (!docSnap.exists) {
        await userRef.set({
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

// ========== FIREBASE WITHDRAW ==========
window.withdraw = async function(walletAddress, historyId) {
    await db.collection("users").doc(walletAddress).collection("history").doc(historyId).update({
        withdrawn: true
    });
    alert("Withdraw request submitted! (Real token transfer needs backend, abhi yeh sirf status badalta hai)");
    location.reload();
};

// ========== REST OF YOUR WALLET LOGIC ==========
window.addEventListener('DOMContentLoaded', function() {
    // --- HTML elements ---
    const connectBtn = document.getElementById('connectWalletBtn');
    const walletAddressDiv = document.getElementById('walletAddress');
    const buyBtn = document.getElementById('buyBtn');
    const messageDiv = document.getElementById('message');
    const ticketInput = document.getElementById('ticketCount');
    const lastLotteryDiv = document.getElementById('lastLotteryDiv');
    const lastLotteryBtn = document.getElementById('lastLotteryBtn');
    const lastLotteryStatus = document.getElementById('lastLotteryStatus');

    let userThBalance = 0;
    let currentWalletAddress = null;

    // By default, buyBtn disabled
    buyBtn.disabled = true;

    function getProvider() {
        if ('solana' in window) {
            const provider = window.solana;
            if (provider.isPhantom) {
                return provider;
            }
        }
        return null;
    }
    function isMobile() {
        return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    }

    // SPL token decimals
    async function getTokenDecimals(mintAddress, connection) {
        const mintAccountInfo = await connection.getParsedAccountInfo(new solanaWeb3.PublicKey(mintAddress));
        return mintAccountInfo.value.data.parsed.info.decimals;
    }

    // Show TH balance
    async function showThCoinBalance(publicKey) {
        try {
            const connection = new solanaWeb3.Connection(ALCHEMY_RPC, "confirmed");
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                publicKey,
                { mint: new solanaWeb3.PublicKey(THEEK_HAI_MINT) }
            );
            userThBalance = 0;
            if (tokenAccounts.value.length > 0) {
                userThBalance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
            }
            let balDiv = document.getElementById('thBalance');
            if (!balDiv) {
                balDiv = document.createElement('div');
                balDiv.id = 'thBalance';
                walletAddressDiv.appendChild(document.createElement('br'));
                walletAddressDiv.appendChild(balDiv);
            }
            balDiv.innerHTML = `<span class="text-primary">Theek Hai Coin Balance: <b>${userThBalance}</b> TH COIN</span>`;
            updateButtonForThBalance();
        } catch (err) {
            let balDiv = document.getElementById('thBalance');
            if (!balDiv) {
                balDiv = document.createElement('div');
                balDiv.id = 'thBalance';
                walletAddressDiv.appendChild(document.createElement('br'));
                walletAddressDiv.appendChild(balDiv);
            }
            balDiv.innerHTML = `<span class="text-danger">Unable to fetch Theek Hai Coin balance.</span>`;
            userThBalance = 0;
            updateButtonForThBalance();
        }
    }

    async function updateButtonForThBalance() {
        let ticketCount = parseInt(ticketInput.value);
        if (isNaN(ticketCount) || ticketCount < 1) ticketCount = 1;

        let thCoinForThisTicket = ENTRY_FEE_TH * ticketCount;

        if (userThBalance >= thCoinForThisTicket) {
            buyBtn.innerText = `Submit Ticket (${thCoinForThisTicket} TH COIN)`;
            buyBtn.className = "btn btn-info";
        } else {
            buyBtn.innerText = `Buy Theek Hai Coin (${thCoinForThisTicket} TH COIN Needed)`;
            buyBtn.className = "btn btn-success";
        }
    }
    ticketInput.addEventListener('input', updateButtonForThBalance);

    // --- Connect Wallet Event ---
    connectBtn.addEventListener('click', async () => {
        const provider = getProvider();
        if (!provider) {
            if (isMobile()) {
                walletAddressDiv.innerHTML = `
                    <span class="text-danger">
                        Mobile pe Phantom Wallet connect karne ke liye:<br>
                        <a href="https://phantom.app/ul/browse/${window.location.href}" target="_blank">
                            Open in Phantom App
                        </a>
                    </span>`;
            } else {
                walletAddressDiv.innerHTML = `<span class="text-danger">
                    Phantom Wallet install karo: <a href="https://phantom.app/" target="_blank">phantom.app</a>
                </span>`;
            }
            return;
        }
        try {
            const resp = await provider.connect();
            currentWalletAddress = resp.publicKey.toString();
            walletAddressDiv.innerHTML = `<span class="text-success">Wallet Connected:<br>${currentWalletAddress}</span>`;
            connectBtn.innerText = "Connected!";
            connectBtn.classList.remove("btn-primary");
            connectBtn.classList.add("btn-secondary");
            connectBtn.disabled = true;
            buyBtn.disabled = false; // enable buy button
            await showThCoinBalance(resp.publicKey);
            await createOrUpdateUser(currentWalletAddress);
            await fetchCurrentLotteryStatus();
            await fetchAndShowHistory(currentWalletAddress);

            // Show/hide Last Lottery Status button based on history
            let userHistoryQuery = await db.collection("users").doc(currentWalletAddress).collection("history").orderBy("createdAt", "desc").limit(1).get();
            if (!userHistoryQuery.empty) {
                lastLotteryDiv.style.display = "block";
            } else {
                lastLotteryDiv.style.display = "none";
            }
        } catch (err) {
            walletAddressDiv.innerHTML = `<span class="text-danger">User cancelled connection</span>`;
        }
    });

    // --- Buy/Submit Ticket Logic ---
    buyBtn.addEventListener('click', async () => {
        // Disallow buy if wallet is not connected
        if (!currentWalletAddress) {
            messageDiv.innerHTML = '<span class="text-danger">Pehle wallet connect karo.</span>';
            return;
        }
        let ticketCount = parseInt(ticketInput.value);
        if (isNaN(ticketCount) || ticketCount < 1) ticketCount = 1;

        let thCoinToSend = ENTRY_FEE_TH * ticketCount;

        // If not enough balance, show buy page
        if (userThBalance < thCoinToSend) {
            window.open('https://pump.fun/8cHTywDEarRcKdBTndHgPnSGANVnGNDbmc7dDVhkpump', '_blank');
            return;
        }

        // ---- SPL token transfer flow ----
        const provider = getProvider();
        if (!provider || !provider.publicKey) {
            messageDiv.innerHTML = '<span class="text-danger">Pehle wallet connect karo.</span>';
            return;
        }

        try {
            messageDiv.innerHTML = "Transaction processing, please approve in Phantom wallet...";
            const connection = new solanaWeb3.Connection(ALCHEMY_RPC, "confirmed");
            const decimals = await getTokenDecimals(THEEK_HAI_MINT, connection);
            const fromTokenAccounts = await connection.getParsedTokenAccountsByOwner(
                provider.publicKey,
                { mint: new solanaWeb3.PublicKey(THEEK_HAI_MINT) }
            );
            if (fromTokenAccounts.value.length === 0) {
                messageDiv.innerHTML = `<span class="text-danger">No Theek Hai Coin token account found in your wallet.</span>`;
                return;
            }
            const fromTokenAccountPubkey = new solanaWeb3.PublicKey(fromTokenAccounts.value[0].pubkey);

            let toTokenAccounts = await connection.getParsedTokenAccountsByOwner(
                new solanaWeb3.PublicKey(POOL_WALLET),
                { mint: new solanaWeb3.PublicKey(THEEK_HAI_MINT) }
            );
            let toTokenAccountPubkey;
            if (toTokenAccounts.value.length === 0) {
                messageDiv.innerHTML = `<span class="text-danger">Pool wallet's token account not found. Please contact admin.</span>`;
                return;
            } else {
                toTokenAccountPubkey = new solanaWeb3.PublicKey(toTokenAccounts.value[0].pubkey);
            }

            const amountToSend = Math.round(thCoinToSend * Math.pow(10, decimals));
            const splToken = window.splToken;
            let transferIx = splToken.Token.createTransferInstruction(
                splToken.TOKEN_PROGRAM_ID,
                fromTokenAccountPubkey,
                toTokenAccountPubkey,
                provider.publicKey,
                [],
                amountToSend
            );

            let transaction = new solanaWeb3.Transaction().add(transferIx);
            transaction.feePayer = provider.publicKey;
            let { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            let signed = await provider.signTransaction(transaction);
            let signature = await connection.sendRawTransaction(signed.serialize());

            // FIREBASE: Add user ticket entry
            let walletAddress = provider.publicKey.toString();
            let userRef = db.collection("users").doc(walletAddress);
            let historyCol = userRef.collection("history");
            let newDoc = historyCol.doc();
            await newDoc.set({
                id: newDoc.id,
                round: 1, // TODO: fetch from lottery status or increment logic
                ticket: Date.now(), // can be more meaningful
                result: "pending",
                amountWon: 0,
                withdrawn: false,
                signature: signature,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            window.location.href = "thankyou.html?tx=" + signature;
        } catch (e) {
            messageDiv.innerHTML = `<span class="text-danger">Token transfer failed: ${e.message || e}</span>`;
        }
    });

    // Last Lottery Status button logic
    if (lastLotteryBtn) {
        lastLotteryBtn.onclick = async function() {
            if (!currentWalletAddress) return;
            let userHistoryQuery = await db.collection("users").doc(currentWalletAddress).collection("history").orderBy("createdAt", "desc").limit(1).get();
            if (!userHistoryQuery.empty) {
                let doc = userHistoryQuery.docs[0].data();
                lastLotteryStatus.innerHTML = `
                    <b>Last Lottery Status:</b><br>
                    Ticket: ${doc.ticket}<br>
                    Result: ${doc.result}<br>
                    Amount Won: ${doc.amountWon} TH Coin
                `;
            }
        };
    }

    // Initial load (show lottery status if not connected)
    fetchCurrentLotteryStatus();
});
