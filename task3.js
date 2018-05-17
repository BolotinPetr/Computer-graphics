var glMat4 = require('gl-mat4')
var stanfordDragon = require('stanford-dragon/4')

// Добавляем и настраиваем canvas
var canvas = document.createElement('canvas')
canvas.width = 600
canvas.height = 600
var mountLocation = document.getElementById('webgl-shadow-map-tut') || document.body
mountLocation.appendChild(canvas)


// включаем depth_test, чтобы знать, находится ли фрагмент за другим 
var gl = canvas.getContext('webgl')
gl.enable(gl.DEPTH_TEST)

// подключаем для подсчёта производных
var EXT_STD_DERI=gl.getExtension("OES_standard_derivatives")||
    gl.getExtension("MOZ_OES_standard_derivatives") ||
    gl.getExtension("WEBKIT_OES_standard_derivatives"); 


var canvasIsPressed = false
var xRotation = Math.PI / 20
var yRotation = 0
var lastPressX
var lastPressY
canvas.onmousedown = function (e) {
  canvasIsPressed = true
  lastPressX = e.pageX
  lastPressY = e.pageY
}
canvas.onmouseup = function () {
  canvasIsPressed = false
}
canvas.onmouseout = function () {
  canvasIsPressed = false
}
canvas.onmousemove = function (e) {
  if (canvasIsPressed) {
    xRotation += (e.pageY - lastPressY) / 50
    yRotation -= (e.pageX - lastPressX) / 50

    xRotation = Math.min(xRotation, Math.PI / 2.5)
    xRotation = Math.max(xRotation, 0.1)

    lastPressX = e.pageX
    lastPressY = e.pageY
  }
}

canvas.addEventListener('touchstart', function (e) {
  lastPressX = e.touches[0].clientX
  lastPressY = e.touches[0].clientY
})
canvas.addEventListener('touchmove', function (e) {
  e.preventDefault()
  xRotation += (e.touches[0].clientY - lastPressY) / 50
  yRotation -= (e.touches[0].clientX - lastPressX) / 50

  xRotation = Math.min(xRotation, Math.PI / 2.5)
  xRotation = Math.max(xRotation, 0.1)

  lastPressX = e.touches[0].clientX
  lastPressY = e.touches[0].clientY
})


var shadowDepthTextureSize = 1024
var lightVertexGLSL = `
attribute vec3 aVertexPosition;

uniform mat4 uPMatrix;
uniform mat4 uMVMatrix;

void main (void) {
  gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
}
`
var lightFragmentGLSL = `
precision mediump float;

vec4 encodeFloat (float depth) {
  const vec4 bitShift = vec4(
    256 * 256 * 256,
    256 * 256,
    256,
    1.0
  );
  const vec4 bitMask = vec4(
    0,
    1.0 / 256.0,
    1.0 / 256.0,
    1.0 / 256.0
  );
  vec4 comp = fract(depth * bitShift);
  comp -= comp.xxyz * bitMask;
  return comp;
}

void main (void) {
  // Encode the distance into the scene of this fragment.
  // We'll later decode this when rendering from our camera's
  // perspective and use this number to know whether the fragment
  // that our camera is seeing is inside of our outside of the shadow
  gl_FragColor = encodeFloat(gl_FragCoord.z);
}
`

/*
  float dx = dFdx(gl_FragCoord.z);
  float dy = dFdy(gl_FragCoord.z);
  gl_FragColor = vec4(gl_FragCoord.z, pow(gl_FragCoord.z, 2.0) + 0.25*(dx*dx + dy*dy), 0.0, 1.0);
*/



var cameraVertexGLSL = `
attribute vec3 aVertexPosition;

uniform mat4 uPMatrix;
uniform mat4 uMVMatrix;
uniform mat4 lightMViewMatrix;
uniform mat4 lightProjectionMatrix;

const mat4 texUnitConverter = mat4(0.5, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.5, 0.5, 0.5, 1.0);

varying vec2 vDepthUv;
varying vec4 shadowPos;

void main (void) {
  gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);

  shadowPos = texUnitConverter * lightProjectionMatrix * lightMViewMatrix * vec4(aVertexPosition, 1.0);
}
`
var cameraFragmentGLSL = `
precision mediump float;

varying vec2 vDepthUv;
varying vec4 shadowPos;

uniform sampler2D depthColorTexture;
uniform vec3 uColor;

float decodeFloat (vec4 color) {
  const vec4 bitShift = vec4(
    1.0 / (256.0 * 256.0 * 256.0),
    1.0 / (256.0 * 256.0),
    1.0 / 256.0,
    1
  );
  return dot(color, bitShift);
}

void main(void) {
  vec3 fragmentDepth = shadowPos.xyz;
  float shadowAcneRemover = 0.007;
  fragmentDepth.z -= shadowAcneRemover;

  float texelSize = 1.0 / ${shadowDepthTextureSize}.0;
  float amountInLight = 0.0;

  //просчитываем тень
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float texelDepth = decodeFloat(texture2D(depthColorTexture, fragmentDepth.xy + vec2(x, y) * texelSize));
      if (fragmentDepth.z < texelDepth) {
        amountInLight += 1.0;
      }
    }
  }
  amountInLight /= 9.0;

/*
  vec2 moments = texture2D(depthColorTexture, fragmentDepth.xy).rg;
  float variance = max(moments.y - moments.x*moments.x
  var amountInLight1= variance/(variance + fragmentDepth.z*fragmentDepth.z)
*/

  gl_FragColor = vec4(amountInLight * uColor, 1.0);
}
`

var cameraVertexShader = gl.createShader(gl.VERTEX_SHADER)
gl.shaderSource(cameraVertexShader, cameraVertexGLSL)
gl.compileShader(cameraVertexShader)

var cameraFragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
gl.shaderSource(cameraFragmentShader, cameraFragmentGLSL)
gl.compileShader(cameraFragmentShader)

var cameraShaderProgram = gl.createProgram()
gl.attachShader(cameraShaderProgram, cameraVertexShader)
gl.attachShader(cameraShaderProgram, cameraFragmentShader)
gl.linkProgram(cameraShaderProgram)

var lightVertexShader = gl.createShader(gl.VERTEX_SHADER)
gl.shaderSource(lightVertexShader, lightVertexGLSL)
gl.compileShader(lightVertexShader)

var lightFragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
gl.shaderSource(lightFragmentShader, lightFragmentGLSL)
gl.compileShader(lightFragmentShader)

var lightShaderProgram = gl.createProgram()
gl.attachShader(lightShaderProgram, lightVertexShader)
gl.attachShader(lightShaderProgram, lightFragmentShader)
gl.linkProgram(lightShaderProgram)


var floorPositions = [
  // Bottom Left (0)
  -30.0, -10.0, 30.0,
  // Bottom Right (1)
  30.0, -10.0, 30.0,
  // Top Right (2)
  30.0, -10.0, -30.0,
  // Top Left (3)
  -30.0, -10.0, -30.0
]
var floorIndices = [
  // Front face
  0, 1, 2, 0, 2, 3
]


//проверял работу на разных объектах

function get_cube_positions(){    
    cubePositions = [
            // Front face
            -10.0,  20.0,  10.0,
             10.0,  20.0,  10.0,
             10.0,  10.0,  10.0,
            -10.0,  10.0,  10.0,
            // Back face
            -10.0,  20.0, -10.0,
            -10.0,  10.0, -10.0,
             10.0,  10.0, -10.0,
             10.0,  20.0, -10.0,
            // Top face
            -10.0,  20.0, -10.0,
            -10.0,  20.0,  10.0,
             10.0,  20.0,  10.0,
             10.0,  20.0, -10.0,
            // Bottom face
            -10.0,  10.0, -10.0,
             10.0,  10.0, -10.0,
             10.0,  10.0,  10.0,
            -10.0,  10.0,  10.0,
            // Right face
             10.0,  20.0, -10.0,
             10.0,  10.0, -10.0,
             10.0,  10.0,  10.0,
             10.0,  20.0,  10.0,
            // Left face
            -10.0,  20.0, -10.0,
            -10.0,  20.0,  10.0,
            -10.0,  10.0,  10.0,
            -10.0,  10.0, -10.0
        ];
    return cubePositions
}

function get_cube_indices(){    
    var cubeIndices = [
            0, 1, 2,      0, 2, 3,    // Front face
            4, 5, 6,      4, 6, 7,    // Back face
            8, 9, 10,     8, 10, 11,  // Top face
            12, 13, 14,   12, 14, 15, // Bottom face
            16, 17, 18,   16, 18, 19, // Right face
            20, 21, 22,   20, 22, 23  // Left face
        ];
    return cubeIndices
}


function calcMobiusPoint(u, v, coef) {
  var x = (4 + ((v * coef) / 2) * Math.cos(u / 2)) * Math.cos(u);
  var y = (8 + ((v * coef) / 2) * Math.cos(u / 2)) * Math.sin(u);
  var z = 1 + ((v * coef) / 2) * Math.sin(u / 2);
  return [x, y, z];
}


function get_mebius_positions(){
    var verticesPerCurve = 120;
    var tBegin = 0.0;
    var tEnd = Math.PI * 2;
    var dt = (tEnd - tBegin) / (verticesPerCurve - 2);
    var stripCoef = 3;
    var vertices = new Array();
    for (var nVertex = 0; nVertex < verticesPerCurve; ++nVertex) {
        var t = tBegin + dt * nVertex;
        var p1 = calcMobiusPoint(t, -1.0, stripCoef);
        var p2 = calcMobiusPoint(t, 1.0, stripCoef);
        // first curve vertex
        vertices[nVertex * 3] = p1[0];
        vertices[nVertex * 3 + 1] = p1[1];
        vertices[nVertex * 3 + 2] = p1[2];
        // second curve vertex
        vertices[(nVertex + verticesPerCurve) * 3] = p2[0];
        vertices[(nVertex + verticesPerCurve) * 3 + 1] = p2[1];
        vertices[(nVertex + verticesPerCurve) * 3 + 2] = p2[2];
    }
    return vertices
}

function get_mebius_indices(){
    var verticesPerCurve = 120;
    var tBegin = 0.0;
    var tEnd = Math.PI * 2;
    var dt = (tEnd - tBegin) / (verticesPerCurve - 2);
    var stripCoef = 0.5;
    var verticesIndices = new Array();
    for (var nVertex1 = 0; nVertex1 < (verticesPerCurve - 1); ++nVertex1) {        
        var nVertex1Next = nVertex1 + 1;
        var nVertex2 = nVertex1 + verticesPerCurve;
        var nVertex2Next = nVertex2 + 1;
        var nPoly1 = nVertex1 * 2;
        var nPoly2 = nPoly1 + 1;
        // first polygon
        verticesIndices[nPoly1 * 3] = nVertex2;
        verticesIndices[nPoly1 * 3 + 1] = nVertex1;
        verticesIndices[nPoly1 * 3 + 2] = nVertex1Next;
        // first polygon
        verticesIndices[nPoly2 * 3] = nVertex1Next;
        verticesIndices[nPoly2 * 3 + 1] = nVertex2Next;
        verticesIndices[nPoly2 * 3 + 2] = nVertex2;        
    }
    return verticesIndices
}

function get_dragon_positions(){
    var dragonPositions = stanfordDragon.positions
    dragonPositions = dragonPositions.reduce(function (all, vertex) {
      // Scale everything down by 10
      all.push(vertex[0] / 10)
      all.push(vertex[1] / 10)
      all.push(vertex[2] / 10)
      return all
    }, [])
    return dragonPositions
}

function get_dragon_indices(){
    var dragonIndices = stanfordDragon.cells
    dragonIndices = dragonIndices.reduce(function (all, vertex) {
    all.push(vertex[0])
    all.push(vertex[1])
    all.push(vertex[2])
    return all
    }, [])
    return dragonIndices 
}

function get_figure_positions(){
    var figurePositions = [
        // Bottom Left (0)
        -10.0, 10.0, 10.0,
        // Bottom Right (1)
        10.0, 10.0, 20.0,
        // Top Right (2)
        10.0, 10.0, -10.0,
        // Top Left (3)
        -10.0, 10.0, -10.0    
        ]
    return figurePositions
    }

function get_figure_indices(){
    var figureIndices = [
        // Front face
        0, 1, 2, 0, 2, 3
        ]
    return figureIndices
}

var dragonPositions = get_cube_positions()
var dragonIndices = get_cube_indices()

var dragonPositions = get_mebius_positions()
var dragonIndices = get_mebius_indices()





var vertexPositionAttrib = gl.getAttribLocation(lightShaderProgram, 'aVertexPosition')
gl.enableVertexAttribArray(vertexPositionAttrib)

var dragonPositionBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, dragonPositionBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dragonPositions), gl.STATIC_DRAW)
gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0)

var dragonIndexBuffer = gl.createBuffer()
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dragonIndexBuffer)
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(dragonIndices), gl.STATIC_DRAW)

var floorPositionBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, floorPositionBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floorPositions), gl.STATIC_DRAW)
gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0)

var floorIndexBuffer = gl.createBuffer()
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, floorIndexBuffer)
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(floorIndices), gl.STATIC_DRAW)


gl.useProgram(lightShaderProgram)

var shadowFramebuffer = gl.createFramebuffer()
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer)

var shadowDepthTexture = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, shadowDepthTexture)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, shadowDepthTextureSize, shadowDepthTextureSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

var renderBuffer = gl.createRenderbuffer()
gl.bindRenderbuffer(gl.RENDERBUFFER, renderBuffer)
gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, shadowDepthTextureSize, shadowDepthTextureSize)

gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowDepthTexture, 0)
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderBuffer)

gl.bindTexture(gl.TEXTURE_2D, null)
gl.bindRenderbuffer(gl.RENDERBUFFER, null)


var lightProjectionMatrix = glMat4.ortho([], -40, 40, -40, 40, -40.0, 80)
var lightViewMatrix = glMat4.lookAt([], [0, 2, -3], [0, 0, 0], [0, 1, 0])

var shadowPMatrix = gl.getUniformLocation(lightShaderProgram, 'uPMatrix')
var shadowMVMatrix = gl.getUniformLocation(lightShaderProgram, 'uMVMatrix')

gl.uniformMatrix4fv(shadowPMatrix, false, lightProjectionMatrix)
gl.uniformMatrix4fv(shadowMVMatrix, false, lightViewMatrix)

gl.bindBuffer(gl.ARRAY_BUFFER, floorPositionBuffer)
gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0)

gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, floorIndexBuffer)
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(floorIndices), gl.STATIC_DRAW)

gl.bindFramebuffer(gl.FRAMEBUFFER, null)


gl.useProgram(cameraShaderProgram)

var samplerUniform = gl.getUniformLocation(cameraShaderProgram, 'depthColorTexture')

gl.activeTexture(gl.TEXTURE0)
gl.bindTexture(gl.TEXTURE_2D, shadowDepthTexture)
gl.uniform1i(samplerUniform, 0)

var uMVMatrix = gl.getUniformLocation(cameraShaderProgram, 'uMVMatrix')
var uPMatrix = gl.getUniformLocation(cameraShaderProgram, 'uPMatrix')
var uLightMatrix = gl.getUniformLocation(cameraShaderProgram, 'lightMViewMatrix')
var uLightProjection = gl.getUniformLocation(cameraShaderProgram, 'lightProjectionMatrix')
var uColor = gl.getUniformLocation(cameraShaderProgram, 'uColor')

gl.uniformMatrix4fv(uLightMatrix, false, lightViewMatrix)
gl.uniformMatrix4fv(uLightProjection, false, lightProjectionMatrix)
gl.uniformMatrix4fv(uPMatrix, false, glMat4.perspective([], Math.PI / 3, 1, 0.01, 900))


var dragonRotateY = 0


function drawShadowMap () {
  dragonRotateY += 0.01

  gl.useProgram(lightShaderProgram)

  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer)

  gl.viewport(0, 0, shadowDepthTextureSize, shadowDepthTextureSize)
  gl.clearColor(0, 0, 0, 1)
  gl.clearDepth(1.0)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  gl.bindBuffer(gl.ARRAY_BUFFER, dragonPositionBuffer)
  gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dragonIndexBuffer)

  var lightDragonMVMatrix = glMat4.create()
  glMat4.rotateY(lightDragonMVMatrix, lightDragonMVMatrix, dragonRotateY)
  glMat4.translate(lightDragonMVMatrix, lightDragonMVMatrix, [0, 0, -3])
  glMat4.multiply(lightDragonMVMatrix, lightViewMatrix, lightDragonMVMatrix)
  gl.uniformMatrix4fv(shadowMVMatrix, false, lightDragonMVMatrix)

  gl.drawElements(gl.TRIANGLES, dragonIndices.length, gl.UNSIGNED_SHORT, 0)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
}

function drawModels () {
  gl.useProgram(cameraShaderProgram)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.98, 0.98, 0.98, 1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  var camera = glMat4.create()
  glMat4.translate(camera, camera, [0, 0, 45])
  var xRotMatrix = glMat4.create()
  var yRotMatrix = glMat4.create()
  glMat4.rotateX(xRotMatrix, xRotMatrix, -xRotation)
  glMat4.rotateY(yRotMatrix, yRotMatrix, yRotation)
  glMat4.multiply(camera, xRotMatrix, camera)
  glMat4.multiply(camera, yRotMatrix, camera)
  camera = glMat4.lookAt(camera, [camera[12], camera[13], camera[14]], [0, 0, 0], [0, 1, 0])

  var dragonModelMatrix = glMat4.create()
  glMat4.rotateY(dragonModelMatrix, dragonModelMatrix, dragonRotateY)
  glMat4.translate(dragonModelMatrix, dragonModelMatrix, [0, 0, 0])

  var lightDragonMVMatrix = glMat4.create()
  glMat4.multiply(lightDragonMVMatrix, lightViewMatrix, dragonModelMatrix)
  gl.uniformMatrix4fv(uLightMatrix, false, lightDragonMVMatrix)

  gl.uniformMatrix4fv(
    uMVMatrix,
    false,
    glMat4.multiply(dragonModelMatrix, camera, dragonModelMatrix)
  )

  gl.uniform3fv(uColor, [0.36, 0.66, 0.8])

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTexture)
  gl.uniform1i(samplerUniform, 0)

  gl.drawElements(gl.TRIANGLES, dragonIndices.length, gl.UNSIGNED_SHORT, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, floorPositionBuffer)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, floorIndexBuffer)
  gl.vertexAttribPointer(vertexPositionAttrib, 3, gl.FLOAT, false, 0, 0)

  gl.uniformMatrix4fv(uLightMatrix, false, lightViewMatrix)
  gl.uniformMatrix4fv(uMVMatrix, false, camera)
  gl.uniform3fv(uColor, [0.6, 0.6, 0.6])

  gl.drawElements(gl.TRIANGLES, floorIndices.length, gl.UNSIGNED_SHORT, 0)
}

function draw () {
  drawShadowMap()
  drawModels()

  window.requestAnimationFrame(draw)
}
draw()
