(() => {

  // ==================================================
  // 　　MAIN
  // ==================================================

  window.addEventListener('load', function() {

    // ==================================================
    // 　　CLASS
    // ==================================================

    // 頂点情報のシェーダー
    const positionFrag = require('./../_shader/position.frag');

    // 移動方向を決定するシェーダー
    const velocityFrag = require('./../_shader/velocity.frag');

    // パーティクルを描写するためのシェーダー
    const perticleVert = require('./../_shader/perticle.vert');
    const perticleFrag = require('./../_shader/perticle.frag');

    const w = 512;
    const perticles = w * w;

    // メモリ負荷確認用
    let stats;

    // 基本セット
    let container, camera, scene, renderer, geometry, controls;

    // gpgpuをするために必要なオブジェクト達
    let gpuCompute;
    let velocityVariable;
    let positionVariable;
    let positionUniforms;
    let velocityUniforms;
    let particleUniforms;
    let effectController;

    let count = 0;

    let init = () => {

      // ===== renderer, camera
      container = document.getElementById('canvas');
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 15000);
      camera.position.y = 120;
      camera.position.z = 200;
      scene = new THREE.Scene();
      renderer = new THREE.WebGLRenderer();
      renderer.setClearColor(0x000000);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      container.appendChild(renderer.domElement);

      // ===== controls
      controls = new THREE.OrbitControls(camera, renderer.domElement);

      // ===== stats
      stats = new Stats();
      stats.setMode(0);
      stats.domElement.style.position = 'absolute';
      stats.domElement.style.left = '0px';
      stats.domElement.style.top = '0px';
      container.appendChild(stats.domElement);
      // container.appendChild(stats.dom);

      window.addEventListener('resize', onWindowResize, false);

      // window.addEventListener('click', onWindowClick, false);
      document.onkeydown = () => {
        if (event.keyCode == 13) {
          onRestart();
        }
      }

      // ***** このコメントアウトについては後述 ***** //
      // effectController = {
      //   time: 0.0,
      // };

      // gpuCopute用のRenderを作る
      initComputeRenderer();

      // particle 初期化
      initPosition();

    }

    // gpuCopute用のRenderを作る
    let initComputeRenderer = () => {

      // gpgpuオブジェクトのインスタンスを格納
      gpuCompute = new GPUComputationRenderer(w, w, renderer);

      // 今回はパーティクルの位置情報と、移動方向を保存するテクスチャを2つ用意します
      let dtPosition = gpuCompute.createTexture();
      let dtVelocity = gpuCompute.createTexture();

      // テクスチャにGPUで計算するために初期情報を埋めていく
      fillTextures(dtPosition, dtVelocity);

      // shaderプログラムのアタッチ
      positionVariable = gpuCompute.addVariable('texturePosition', positionFrag, dtPosition);
      velocityVariable = gpuCompute.addVariable('textureVelocity', velocityFrag, dtVelocity);

      // 一連の関係性を構築するためのおまじない
      gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
      gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

      // uniform変数を登録したい場合は以下のように作る
      positionUniforms = positionVariable.material.uniforms;
      velocityUniforms = velocityVariable.material.uniforms;

      positionUniforms.time = {
        type: 'f',
        value: 0.0
      };

      velocityUniforms.time = {
        type: 'f',
        value: 0.0
      };

      /*
      ***********************************
      たとえば、上でコメントアウトしているeffectControllerオブジェクトのtimeを
      わたしてあげれば、effectController.timeを更新すればuniform変数も変わったり、ということができる
      velocityUniforms.time = { value: effectController.time };
      ************************************
      */

      let error = gpuCompute.init();
      if (error !== null) {
        console.error(error);
      }

    }

    // restart用関数 今回は使わない
    let restartSimulation = () => {
      let dtPosition = gpuCompute.createTexture();
      let dtVelocity = gpuCompute.createTexture();
      fillTextures(dtPosition, dtVelocity);
      gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[0]);
      gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[1]);
      gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[0]);
      gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[1]);
    }

    // パーティクルそのものの情報を決めていく。
    let initPosition = () => {

      // 最終的に計算された結果を反映するためのオブジェクト。
      // 位置情報はShader側(texturePosition, textureVelocity)
      // で決定されるので、以下のように適当にうめちゃってOK

      geometry = new THREE.BufferGeometry();
      let positions = new Float32Array(perticles * 3);
      let p = 0;
      for (let i = 0; i < perticles; i++) {
        positions[p++] = 0;
        positions[p++] = 0;
        positions[p++] = 0;
      }

      // uv情報の決定。テクスチャから情報を取り出すときに必要
      let uvs = new Float32Array(perticles * 2);
      p = 0;
      for (let j = 0; j < w; j++) {
        for (let i = 0; i < w; i++) {
          uvs[p++] = i / (w - 1);
          uvs[p++] = j / (w - 1);
        }
      }

      // attributeをgeometryに登録する
      geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.addAttribute('uv', new THREE.BufferAttribute(uvs, 2));

      // uniform変数をオブジェクトで定義
      // 今回はカメラをマウスでいじれるように、計算に必要な情報もわたす。
      particleUniforms = {
        texturePosition: {
          value: null
        },
        textureVelocity: {
          value: null
        },
        cameraConstant: {
          value: getCameraConstant(camera)
        }
      };

      // Shaderマテリアル これはパーティクルそのものの描写に必要なシェーダー
      let material = new THREE.ShaderMaterial({
        uniforms: particleUniforms,
        vertexShader: perticleVert,
        fragmentShader: perticleFrag
      });
      material.extensions.drawBuffers = true;

      let particles = new THREE.Points(geometry, material);
      particles.matrixAutoUpdate = false;
      particles.updateMatrix();

      // パーティクルをシーンに追加
      scene.add(particles);
    }

    // テクスチャ定義?
    let fillTextures = (texturePosition, textureVelocity) => {

      // textureのイメージデータをいったん取り出す
      let posArray = texturePosition.image.data;
      let velArray = textureVelocity.image.data;

      // パーティクルの初期の位置は、ランダムなXZに平面おく。
      // 板状の正方形が描かれる
      for (let k = 0, kl = posArray.length; k < kl; k += 4) {

        let x, y, z;
        // x = 0.0;
        // y = 0.0;
        // z = 0.0;
        x = Math.random() * 50 - 25;
        y = Math.random() * 50 - 25;
        z = Math.random() * 50 - 25;

        posArray[k + 0] = x;
        posArray[k + 1] = y;
        posArray[k + 2] = z;
        posArray[k + 3] = 0;

        velArray[k + 0] = 0;
        velArray[k + 1] = 0;
        velArray[k + 2] = 0;
        velArray[k + 3] = 0;

      }

    }

    // カメラオブジェクトからシェーダーに渡したい情報を引っ張ってくる関数
    // カメラからパーティクルがどれだけ離れてるかを計算し、パーティクルの大きさを決定するため。
    let getCameraConstant = (camera) => {
      return window.innerHeight / (Math.tan(THREE.Math.DEG2RAD * 0.5 * camera.fov) / camera.zoom);
    }

    // 画面がリサイズされたときの処理
    // ここでもシェーダー側に情報を渡す。
    let onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      particleUniforms.cameraConstant.value = getCameraConstant(camera);
    }

    let onRestart = () => {
      console.log('onRestart')

      let dtPosition = gpuCompute.createTexture();
      let dtVelocity = gpuCompute.createTexture();
      let posArray = dtPosition.image.data;
      let velArray = dtVelocity.image.data;

      const tween = new TimelineMax();

      for (let k = 0, kl = posArray.length; k < kl; k += 4) {

        let x, y, z;
        x = Math.random() * 500 - 250;
        y = Math.random() * 500 - 250;
        z = Math.random() * 500 - 250;

        posArray[k + 0] = x;
        posArray[k + 1] = y;
        posArray[k + 2] = z;
        posArray[k + 3] = 0;

        velArray[k + 0] = Math.random() * 2.0 - 1.0;
        velArray[k + 1] = Math.random() * 2.0 - 1.0;
        velArray[k + 2] = Math.random() * 2.0 - 1.0;
        velArray[k + 3] = Math.random() * 2.0 - 1.0;

      }
      gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[0]);
      gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[1]);
      gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[0]);
      gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[1]);
    }

    let animate = () => {
      render();
      stats.update();
      requestAnimationFrame(animate);
    }

    let render = () => {

      count++;
      scene.rotation.y = count * 0.002;

      // effectController.time += 0.05;
      // velocityUniforms.time.value = effectController.time;

      positionUniforms.time.value += 0.05;
      velocityUniforms.time.value += 0.05;

      // 計算用のテクスチャを更新
      gpuCompute.compute();

      // 計算した結果が格納されたテクスチャをレンダリング用のシェーダーに渡す
      particleUniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
      particleUniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
      renderer.render(scene, camera);
    }

    init();
    animate();

  }, false);

})();
