// ==UserScript==
// @name         krunker aim assist
// @namespace    http://tampermonkey.net/
// @version      2024-11-28
// @description  krunker smooth aim assist with FOV check
// @author       kujoun
// @match        https://krunker.io/*
// @require      https://unpkg.com/three@0.150.0/build/three.min.js
// @grant        none
// ==/UserScript==


(function() {
    'use strict';
    //setup THREE js
    const THREE = window.THREE;
    delete window.THREE;

    let scene;

    const tempVector = new THREE.Vector3();
    const tempObject = new THREE.Object3D();
    tempObject.rotation.order = 'YXZ';

    const clientConfig = {
        fovLock: false,
        aim: false
    }


    const aimConfig = {
        smoothness: 0.15,
        fovAngle: 25,
        enabled: false,
        minDistance: 9.5
    };

    let isRightMouseDown = false;

    let hooked = false;

    const x = {
        window: window,
	    document: document,
	    querySelector: document.querySelector,
	    consoleLog: console.log,
        consoleClear: console.clear,
	    ReflectApply: Reflect.apply,
	    ArrayPrototype: Array.prototype,
	    ArrayPush: Array.prototype.push,
	    ObjectPrototype: Object.prototype,
	    clearInterval: window.clearInterval,
	    setTimeout: window.setTimeout,
	    reToString: RegExp.prototype.toString,
	    indexOf: String.prototype.indexOf,
	    requestAnimationFrame: window.requestAnimationFrame
    }

    const proxied = function ( object ) {
        try {
            if ( typeof object === 'object' &&
                typeof object.parent === 'object' &&
                object.parent.type === 'Scene' &&
                object.parent.name === 'Main' ) {
                x.consoleLog( 'Found Scene!' )
                scene = object.parent;
                x.ArrayPrototype.push = x.ArrayPush;
            }

        } catch ( error ) {}
        return x.ArrayPush.apply( this, arguments );
    }

    let injectTimer = null;

    function animate() {
        x.requestAnimationFrame.call( x.window, animate );
        if ( ! scene && ! injectTimer ) {
            const el = x.querySelector.call( x.document, '#loadingBg' );
            if ( el && el.style.display === 'none' ) {
                x.consoleLog( 'Injecting!' );
                injectTimer = x.setTimeout.call( x.window, () => {
                    x.consoleLog( 'Injected!' );
                    x.ArrayPrototype.push = proxied;
                    hooked = false;
                }, 2e3 );
            }
        }
        if (scene === undefined || ! scene.children) {
            return;
        }
        
        hooks();

        update();

        if (isRightMouseDown && clientConfig.aim) {
            AutoAim();
        }

    }


    let myPlayer = null;
    let target = null;
    let targetDistance = Infinity;
    const players = [];

    let settings = {}


    function update() {
        players.length = 0;

        for (let i = 0; i < scene.children.length; i++) {
            const child = scene.children[i];
            if (child.type === 'Object3D') {
                try {
                    if (child.children[0].children[0].type === 'PerspectiveCamera') {
                        myPlayer = child;
                    }else {
                        players.push(child);
                    }  
			    } catch (err) {}
		    }
	    }
	    targetDistance = Infinity;
	    target = null;
    }
    
    let originalFov = 0;
    let originalFov2 = 0

    function hooks() {
        if(hooked) return;

        settings.fovLocked = myPlayer.children[0].children[0].fov;

        Object.defineProperty(myPlayer.children[0].children[0], 'fov', {
            get() {
                if(clientConfig.fovLock) {
                    return originalFov;
                }
                return settings.fovLocked;  
            },
            set(value) {
                originalFov = value;
            },
            configurable: true,
            enumerable: true
        });
        Object.defineProperty(myPlayer.children[0], 'fov', {
            get() {
                if(clientConfig.fovLock) {
                    return originalFov2;
                }
                return settings.fovLocked;
            },
            set(value) {
                originalFov2 = value;
            },
            configurable: true,
            enumerable: true
        });
        
        const proto1 = Object.getPrototypeOf(scene);
        const proto2 = Object.getPrototypeOf(proto1);
        //x.consoleLog(proto2)
        const originalAdd = proto2.add;

        proto2.add = function(obj) {
            //x.consoleLog("Added:", obj);
            if(obj.parent !== null && obj.parent.type === 'Scene') {
                scene = obj;
                x.consoleLog("updated Scene")
            }
            return originalAdd.apply(this, arguments);
        };
        
        const Vector3 = scene.children[0].position;
        const Vec3proto1 = Object.getPrototypeOf(Vector3);
        const originalProject = Vec3proto1.project;

        Vec3proto1.project = function(...args) {
            //x.consoleLog("Projected camera: ", args);
            const dis = this.distanceTo(myPlayer.position);
            if(dis <= targetDistance && dis > aimConfig.minDistance) {
                target = this;
                targetDistance = dis;
            }
            const orig = originalProject.apply(this, arguments);
            //x.consoleLog("Projected vector: ", orig);
            return orig;
        };
        
        hooked = true;
    }

    function AutoAim() {
        if(!target) return;

        tempVector.setScalar(0);
        tempVector.copy(target);

        tempObject.position.copy(myPlayer.position);
        tempObject.lookAt(tempVector);

        const targetRotationX = -tempObject.rotation.x;
        const targetRotationY = tempObject.rotation.y + Math.PI;

        myPlayer.children[0].rotation.x = lerpAngle(
            myPlayer.children[0].rotation.x,
            targetRotationX,
            aimConfig.smoothness
        );

        myPlayer.rotation.y = lerpAngle(
            myPlayer.rotation.y,
            targetRotationY,
            aimConfig.smoothness
        );
    }

    function lerpAngle(current, target, factor) {
        let diff = target - current;

        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        return current + diff * factor;
    }

    function isInFOV(myPlayer, targetPlayer) {
        const playerDirection = new THREE.Vector3(0, 0, -1);
        playerDirection.applyQuaternion(myPlayer.quaternion);
        playerDirection.normalize();

        const targetDirection = new THREE.Vector3();
        targetDirection.subVectors(targetPlayer.position, myPlayer.position);
        targetDirection.normalize();

        const angle = playerDirection.angleTo(targetDirection);
        const angleDegrees = THREE.MathUtils.radToDeg(angle);

        return angleDegrees <= aimConfig.fovAngle;
    }

    function getTargetPlayer(myPlayer) {
        let targetPlayer = null;
        let minDistance = Infinity;

        for (let i = 0; i < players.length; i++) {
            const player = players[i];

            const distance = player.position.distanceTo(myPlayer.position);

            if(distance <= aimConfig.minDistance || player.position.equals(myPlayer.position)) {
                continue;
            }

            if (!isInFOV(myPlayer, player)) {
                continue;
            }

            if (distance < minDistance) {
			    targetPlayer = player;
			    minDistance = distance;
		    }
        }

        return targetPlayer;
    }

    //mouse listeners
    document.addEventListener('mousedown', function(event) {
        if (event.button === 2) {
            isRightMouseDown = true;
            targetDistance = Infinity;
            x.consoleLog('Aim assist ZAPNUT');
        }
    }, true);

    document.addEventListener('mouseup', function(event) {
        if (event.button === 2) {
            isRightMouseDown = false;
            x.consoleLog('Aim assist VYPNUT');
        }
    }, true);

    window.addEventListener('mousedown', function(event) {
        if (event.button === 2) {
            isRightMouseDown = true;
            targetDistance = Infinity;
            x.consoleLog('Aim assist ZAPNUT (window)');
        }
    }, true);

    window.addEventListener('mouseup', function(event) {
        if (event.button === 2) {
            isRightMouseDown = false;
            x.consoleLog('Aim assist VYPNUT (window)');
        }
    }, true);

    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    }, true);

    // ========== GUI MENU ==========
    function createMenu() {
        // CSS styly
        const style = document.createElement('style');
        style.textContent = `
            #aimAssistMenu {
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
                border: 2px solid #00ff88;
                border-radius: 12px;
                padding: 20px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: #ffffff;
                z-index: 10000;
                min-width: 300px;
                box-shadow: 0 8px 32px rgba(0, 255, 136, 0.3);
                backdrop-filter: blur(10px);
            }

            #aimAssistMenu.minimized {
                padding: 10px 15px;
                min-width: auto;
            }

            #aimAssistMenu.minimized .menuContent {
                display: none;
            }

            .menuHeader {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                padding-bottom: 10px;
                border-bottom: 2px solid #00ff88;
            }

            .menuTitle {
                font-size: 18px;
                font-weight: bold;
                color: #00ff88;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .minimizeBtn {
                background: none;
                border: none;
                color: #00ff88;
                font-size: 20px;
                cursor: pointer;
                padding: 0;
                width: 25px;
                height: 25px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s;
            }

            .minimizeBtn:hover {
                transform: scale(1.2);
            }

            .menuSection {
                margin-bottom: 20px;
            }

            .sectionTitle {
                font-size: 14px;
                color: #00ff88;
                margin-bottom: 10px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .menuItem {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                padding: 8px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                transition: background 0.2s;
            }

            .menuItem:hover {
                background: rgba(255, 255, 255, 0.1);
            }

            .menuLabel {
                font-size: 13px;
                color: #e0e0e0;
            }

            .toggleSwitch {
                position: relative;
                width: 50px;
                height: 24px;
                background: #3a3a4a;
                border-radius: 12px;
                cursor: pointer;
                transition: background 0.3s;
            }

            .toggleSwitch.active {
                background: #00ff88;
            }

            .toggleSlider {
                position: absolute;
                top: 2px;
                left: 2px;
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                transition: transform 0.3s;
            }

            .toggleSwitch.active .toggleSlider {
                transform: translateX(26px);
            }

            .sliderContainer {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .sliderInput {
                width: 100%;
                height: 6px;
                border-radius: 3px;
                background: #3a3a4a;
                outline: none;
                -webkit-appearance: none;
            }

            .sliderInput::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #00ff88;
                cursor: pointer;
                box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
            }

            .sliderInput::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #00ff88;
                cursor: pointer;
                border: none;
                box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
            }

            .sliderValue {
                font-size: 12px;
                color: #00ff88;
                text-align: right;
            }

            .dragHandle {
                cursor: move;
                padding: 5px;
                text-align: center;
                color: #00ff88;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);

        // HTML menu
        const menu = document.createElement('div');
        menu.id = 'aimAssistMenu';
        menu.innerHTML = `
            <div class="dragHandle">≡ Drag to move ≡</div>
            <div class="menuHeader">
                <div class="menuTitle">Aim Assist</div>
                <button class="minimizeBtn">−</button>
            </div>
            <div class="menuContent">
                <div class="menuSection">
                    <div class="sectionTitle">Client Config</div>
                    <div class="menuItem">
                        <span class="menuLabel">FOV Lock</span>
                        <div class="toggleSwitch" id="fovLockToggle">
                            <div class="toggleSlider"></div>
                        </div>
                    </div>
                    <div class="menuItem">
                        <span class="menuLabel">Aim Assist</span>
                        <div class="toggleSwitch" id="aimToggle">
                            <div class="toggleSlider"></div>
                        </div>
                    </div>
                </div>
                <div class="menuSection">
                    <div class="sectionTitle">Aim Config</div>
                    <div class="menuItem">
                        <span class="menuLabel">Smoothness</span>
                        <div class="sliderContainer" style="width: 120px;">
                            <input type="range" class="sliderInput" id="smoothnessSlider" min="0.01" max="1" step="0.01" value="${aimConfig.smoothness}">
                            <div class="sliderValue">${aimConfig.smoothness.toFixed(2)}</div>
                        </div>
                    </div>
                    <div class="menuItem">
                        <span class="menuLabel">FOV Angle</span>
                        <div class="sliderContainer" style="width: 120px;">
                            <input type="range" class="sliderInput" id="fovAngleSlider" min="5" max="90" step="1" value="${aimConfig.fovAngle}">
                            <div class="sliderValue">${aimConfig.fovAngle}°</div>
                        </div>
                    </div>
                    <div class="menuItem">
                        <span class="menuLabel">Min Distance</span>
                        <div class="sliderContainer" style="width: 120px;">
                            <input type="range" class="sliderInput" id="minDistanceSlider" min="1" max="50" step="0.5" value="${aimConfig.minDistance}">
                            <div class="sliderValue">${aimConfig.minDistance.toFixed(1)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(menu);

        // Toggle switchery
        const fovLockToggle = document.getElementById('fovLockToggle');
        const aimToggle = document.getElementById('aimToggle');
        const minimizeBtn = menu.querySelector('.minimizeBtn');

        fovLockToggle.addEventListener('click', () => {
            clientConfig.fovLock = !clientConfig.fovLock;
            fovLockToggle.classList.toggle('active', clientConfig.fovLock);
        });

        aimToggle.addEventListener('click', () => {
            clientConfig.aim = !clientConfig.aim;
            aimToggle.classList.toggle('active', clientConfig.aim);
        });

        // Slidery
        const smoothnessSlider = document.getElementById('smoothnessSlider');
        const fovAngleSlider = document.getElementById('fovAngleSlider');
        const minDistanceSlider = document.getElementById('minDistanceSlider');

        smoothnessSlider.addEventListener('input', (e) => {
            aimConfig.smoothness = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = aimConfig.smoothness.toFixed(2);
        });

        fovAngleSlider.addEventListener('input', (e) => {
            aimConfig.fovAngle = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = aimConfig.fovAngle + '°';
        });

        minDistanceSlider.addEventListener('input', (e) => {
            aimConfig.minDistance = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = aimConfig.minDistance.toFixed(1);
        });

        // Minimize
        minimizeBtn.addEventListener('click', () => {
            menu.classList.toggle('minimized');
            minimizeBtn.textContent = menu.classList.contains('minimized') ? '+' : '−';
        });

        // Drag funkce
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;

        const dragHandle = menu.querySelector('.dragHandle');

        dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialX = e.clientX - menu.offsetLeft;
            initialY = e.clientY - menu.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                menu.style.left = currentX + 'px';
                menu.style.top = currentY + 'px';
                menu.style.right = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Vytvoření menu po načtení stránky
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createMenu);
    } else {
        createMenu();
    }

    animate();
})();