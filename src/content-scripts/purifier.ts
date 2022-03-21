import { dbg, dbgLog, dbgTime, dbgTimeEnd, getDomain, hashCode, isGif, isValidUrl } from "@/util";
import { CensoringState, ImageStyleElement, VideoCensoringOptions } from "./types";
import { generateUUID, getRandom } from "@/util";
import { debounce } from "throttle-debounce";
import { LocalPlaceholder } from "@/placeholders";
import { PlaceholderService } from "@/services/placeholder-service";
import browser from 'webextension-polyfill';
import { ImageTracker } from "./image-tracker";

export class Purifier {
    private _currentState: CensoringState;
    
    private _backlog : boolean = false;
    private _port: browser.Runtime.Port | undefined;
    private _portFaulted: boolean = false;

    private _cache: ImageTracker = new ImageTracker();

    public get backlog() : boolean {
        return this._backlog;
    }
    public set backlog(v : boolean) {
        this._backlog = v;
        if (this._backlog) {
            this.queueStart();
        }
    }

    private queueStart = debounce(1000, () => {
        dbgLog('debounce complete, running purifier');
        this._backlog = false;
        this._start();
    });
    
    private _placeholders: LocalPlaceholder[];
    private _domain: any;
    private _ready: boolean;
    public get ready(): boolean {
        return this._ready;
    }
    public set ready(v : boolean) {
        this._ready = v;
    }

    
    private _urlTransformers : ((url: string) => string)[] = [];
    public get urlTransformers() : ((url: string) => string)[] {
        return this._urlTransformers;
    }
    
    private _videoOptions: VideoCensoringOptions;
    /**
     *
     */
    constructor(state: CensoringState, videoMode: VideoCensoringOptions, location: Location | string, placeholders: LocalPlaceholder[], cache?: ImageTracker) {
        // Only update once in a while.
        this._currentState = state;
        this._placeholders = placeholders;
        this._ready = true
        this._videoOptions = videoMode;
        if (typeof location !== 'string') {
            location = (location as Location).hostname;
        }
        this._domain = getDomain(location).toLowerCase();
        this._urlTransformers.push(srcUrl => srcUrl.replace(".gifv", ".gif"))
        if (cache) {
            this._cache = cache;
        }
    }

    
    public get port() : browser.Runtime.Port | undefined {
        return this._port;
    }
    public set port(v : browser.Runtime.Port|undefined) {
        this._port = v;
    }

    
    private _hideDomains : boolean = false;
    public get hideDomains() : boolean {
        return this._hideDomains;
    }
    public set hideDomains(v : boolean) {
        this._hideDomains = v;
    }
    

    private getPlaceholderSrc = () => {
        let placeholder = browser.runtime.getURL('/images/loading.png');
        if (this._placeholders.length && this._placeholders.length > 0) {
            try {
            const random = getRandom(this._placeholders);
            
            const src = PlaceholderService.toSrc(random);
            placeholder = src ? src : placeholder;
            } catch {
                console.warn('failed to get placeholder!');
            }
        }
        return placeholder;
    }

    private getVideoPlaceholderSrc = (): {poster: string, video: string} => {
        const placeholder = browser.runtime.getURL("images/poster.jpg");
        const video = browser.runtime.getURL("images/blocked_video.mp4");
        return {poster: placeholder, video};
    }

    private _start = () => {
        const elements = document.body.getElementsByTagName("img");
        const bgElements = document.body.getElementsByTagName("*");
        //images first
        const elementArr: HTMLImageElement[] = []
        for (const elem of elements) {
            elementArr.push(elem);
        }
        const targetEls = this.discoverImages(elementArr);

        for (const [idx, el] of targetEls.entries()) {
            this.censorImage(el, false, targetEls.length - idx);
        }
        // then backgrounds
        const targetBacks = this.discoverStyleImages([...bgElements]);
        for (const target of targetBacks) {
            this.censorStyleImage(target);
        }
        // then videos
        if (this._currentState.activeCensoring && this._videoOptions.videoMode == "Block") {
            const videoElements = this.discoverVideos(['video', 'video-element']);
            this.disableVideos(videoElements);
        }
    }

    run = () => {
        this.queueStart();
    }

    private discoverStyleImages = (elements: Element[]) => {
        const backgroundEls: ImageStyleElement[] = elements.map(el => {
            const style = window.getComputedStyle(el, null);
            const background = style.getPropertyValue("background")
            return {element: el, background};
        }).filter(bg => !!bg.background);
        const matchingEls = backgroundEls.map(bg => {
            if (bg.background) { // should this be background-image?
                //thanks https://stackoverflow.com/a/34166861
                const urlMatch = /[:,\s]\s*url\s*\(\s*(?:'(\S*?)'|"(\S*?)"|((?:\\\s|\\\)|\\\"|\\\'|\S)*?))\s*\)/gi
                const match = urlMatch.exec(bg.background);
                if (match) {
                    bg.imageUrl = match.slice(1).find(m => !!m)
                }
            }
            return bg;
        });
        return matchingEls;
    }

    private flattenSrc = (el: HTMLImageElement) => {
        if (el.tagName === "IMG" && el.srcset.length > 0) {
            const url = el.currentSrc;
            if (url !== "" && isValidUrl(url)) {
                el.srcset = "";
                el.src = url;
            }
        }
    }

    private discoverImages = (elements: HTMLImageElement[]): HTMLImageElement[] => {
        const targetEls: HTMLImageElement[] = [];
        const otherEls: {el: HTMLImageElement, center: {x: number, y: number}}[] = [];
        elements.forEach(el => {
            this.flattenSrc(el);
            if (el.tagName === "IMG" && isValidUrl(el.src) && (this._videoOptions.gifsAsVideos ? !isGif(el.src) : true)) {
                // if (this.isUnsafe(el) && !this._safeList.includes(hashCode(el.src))) {
                if (this.isUnsafe(el)) {
                    const domState = this.getVisibility(el);
                    if (domState.visible) {
                        dbg('dom: identified element as visible', el);
                        targetEls.push(el);
                    } else {
                        otherEls.push({el, center: domState.center});
                    }
                    // this.purifyImage(el);
                }
            }
        });
        otherEls.sort((a, b) => {
            const yDiff = Math.abs(a.center.y)-Math.abs(b.center.y);
            return yDiff == 0 ? a.center.x-b.center.x : yDiff
        });
        return targetEls.concat(otherEls.map(e => e.el));
    }

    getVisibility(elem: HTMLElement) {
        const state = {visible: true, center: {x: 0, y: 0}};
        if (!(elem instanceof Element)) throw Error('DomUtil: elem is not an element.');
        const style = getComputedStyle(elem);
        if (style.display === 'none') state.visible = false;
        if (style.visibility !== 'visible') state.visible = false;
        if (elem.offsetWidth + elem.offsetHeight + elem.getBoundingClientRect().height +
            elem.getBoundingClientRect().width === 0) {
            state.visible = false;
        }
        const elemCenter   = {
            x: elem.getBoundingClientRect().left + elem.offsetWidth / 2,
            y: elem.getBoundingClientRect().top + elem.offsetHeight / 2
        };
        if (elemCenter.x < 0) state.visible = false;
        if (elemCenter.x > (document.documentElement.clientWidth || window.innerWidth)) state.visible = false;
        if (elemCenter.y < 0) state.visible = false;
        if (elemCenter.y > (document.documentElement.clientHeight || window.innerHeight)) state.visible = false;
        state.center = elemCenter;
        return state;
    }

    censorImage = (img: HTMLImageElement, runOnce: boolean, priority?: number) => {
        this.flattenSrc(img);
        if (runOnce || (img.complete && img.naturalWidth > 0)) {
            const url = this.normalizeSrcUrl(img);
            this.censorLoadedImage(url, img, runOnce ? true : (this._currentState && this._currentState.activeCensoring));
        } else if (!runOnce) {
            this.backlog = true;
        } else {
            // dbgLog('unmatched');
        }
    }

    // backend seems to take almost anything these days
    // this is more of an extension point.
    private normalizeSrcUrl = (img: HTMLImageElement) => {
        const imageURL = img.getAttribute('censor-src') ?? img.getAttribute('src')!;
        return this.normalizeUrl(imageURL);
    }

    private normalizeUrl = (srcUrl: string) => {
        if (srcUrl) {
            for (const func of this._urlTransformers) {
                srcUrl = func(srcUrl) ?? srcUrl;
            }
        }
        return srcUrl;
    }

    private censorLoadedImage = (imageURL: string, img: HTMLImageElement, active: boolean, priority?: number) => {
        if (this.isUnsafe(img) && this._ready) {
            if (img.width * img.height > 15000 && img.width > 100 && img.height > 100 && !imageURL.includes(".svg")) {
                const uniqueID = img.getAttribute('censor-id') ?? generateUUID();
                img.setAttribute('censor-id', uniqueID);
                img.setAttribute('censor-src', imageURL);
                if (img.clientWidth > 0) {
                    img.width = img.clientWidth;
                }
                if (active) {
                    const result = this._cache.getCensored({src: imageURL});
                    if (result) {
                        dbg('found matching cache result', imageURL);
                        img.src = result;
                        img.toggleAttribute('censor-placeholder', false);
                        img.setAttribute('censor-state', 'censored');
                    } else {
                        img.setAttribute('censor-state', 'censoring');
                        const placeholder = this.getPlaceholderSrc();
                        // console.log(`got placeholder URL: ${placeholder}`);
                        // const priority = img.getBoundingClientRect().top | 0;
                        priority ??= 0;
                        // const priority = Math.abs(this.getVisibility(img).center.y);
                        const placeHolderImage = new Image();
                        placeHolderImage.onload = () => {
                            img.addEventListener('load', () => {
                                img.setAttribute('censor-state', 'censored');
                            }, { once: true });
                            img.src = placeHolderImage.src;
                            img.toggleAttribute('censor-placeholder', true);
                            this.sendCensorRequest(imageURL, uniqueID, priority);
                        };
                        placeHolderImage.setAttribute('src', placeholder);
                    }
                } else {
                    this.setImgExcluded(img, 'disabled');
                }
            } else {
                this.setImgExcluded(img, 'size_format');
            }
        } else {
            this.backlog = true;
        }
    }

    private sendCensorRequest = async (imageSrc: string, id: string, priority?: number) => {
        dbgTime('purifier:loadImageData', id);
        let imageUrl: string = imageSrc;
        try {
            imageUrl = await toDataURL(imageSrc, "image/jpeg");
        } catch (e) {
            console.log('failed to get image data', e);
            imageUrl = imageSrc;
        }
        dbgTimeEnd('purifier:loadImageData', id);
        const msg = {
            msg: 'censorRequest',
            imageURL: imageUrl,
            srcUrl: imageSrc,
            id: id,
            priority: priority ?? 1,
            domain: getDomain(this._domain, this._hideDomains)
        };
        this._cache.trackImage(id, imageSrc);
        if (false) {

        } else {
            // dbg('sending censor request', msg);
            const port = browser.runtime.connect({name: id});
            if (port) {
                port.onMessage.addListener((msg, port) => {
                    handleCensorResult(msg, port, this._cache);
                });
                port.postMessage(msg);
            } else if (this._port && !this._portFaulted) {
                dbg('using existing port for runtime message');
                try {
                    this._port.postMessage(msg);
                } catch (e: any) {
                    console.warn('pipe: port faulted!', e);
                    this._portFaulted = true;
                    browser.runtime.sendMessage(msg);
                }
            } else {
                // console.debug('using runtime for message');
                console.warn('pipe: falling back to global on purifier!');
                browser.runtime.sendMessage(msg);
            }
        }
        // this.messageQueue.push(id);
    }

    private censorStyleImage = (img: ImageStyleElement) => {
        if (img.imageUrl) {
            const imageURL = this.normalizeUrl(img.imageUrl);
            if (isValidUrl(imageURL) && !imageURL.includes(".svg") && this.isUnsafe(img.element)) {
                // const image = new Image();

                // just in case it is not already loaded
                // image.addEventListener('load', () => {
                //     if (image.width * image.height > 15000 && image.width > 100 && image.height > 100) {
                        
                //     } else {
                //         this.setExcluded(img.element, 'size');
                //     }
                // }, { once: true });
                // image.src = imageURL;
                const uniqueID = generateUUID();
                img.element.setAttribute('censor-id', uniqueID);
                if (this._currentState && this._currentState.activeCensoring) {
                    const result = this._cache.getCensored({src: imageURL});
                    if (result) {
                        dbgLog('found matching cache result', imageURL);
                        (img.element as HTMLElement).style.backgroundImage = 'url("' + result + '")';
                        (img.element as HTMLElement).toggleAttribute('censor-placeholder', false);
                    } else {
                        const placeholder = this.getPlaceholderSrc();
                        try {
                            (img.element as HTMLElement).style.backgroundImage = 'url("' + placeholder + '")';
                            (img.element as HTMLElement).toggleAttribute('censor-placeholder', true);
                        } catch { }
                        this.sendCensorRequest(imageURL, uniqueID, 1);
                    }
                }
                img.element.setAttribute('censor-style', 'censored');
            }
        } else {
            this.setExcluded(img.element, 'unmatched_url');
        }
    }

    private discoverVideos = (tagNames: string[]) => {
        const allEls = tagNames.map(tn => document.getElementsByTagName(tn)).flatMap(a => [...a]);
        return allEls;
    }

    private disableVideos = (elements: Element[]) => {
        for (const videoEl of elements) {
            if (this.isUnsafe(videoEl)) {
                const videoPl = this.getVideoPlaceholderSrc();
                videoEl.outerHTML = `<video censor-state="censored" poster='${videoPl.poster}'>` +
                    `<source type="video/mp4" src="${videoPl.video}">` +
                    `</video>`;
                // const srcEl = videoEl.getElementsByTagName('source');
                // if (srcEl && srcEl.length == 1) {
                //     srcEl[0].setAttribute('src', videoPl.video);
                // }
            }
        }
    }

    private isUnsafe = (el: Element) => {
        let replaced = false;
        const elState = el.tagName == "IMG" ? el.getAttribute('censor-state') : el.getAttribute('censor-style');
        if (el.getAttribute('censor-id') && el.getAttribute('src')) {
            replaced = !el.getAttribute('src')!.startsWith('data:image');
        }
        const state = this.isUnsafeState(elState);
        return state || replaced;
    }

    private isUnsafeState = (elState: string | null) => {
        return elState !== 'censored' && elState !== 'censoring' && elState !== 'excluded';
    }

    private setExcluded(el: Element, reason?: string) {
        el.setAttribute('censor-style', 'excluded');
        if (reason) {
            const existing = (el.getAttribute('censor-exclusion') ?? '').replace(reason, '').trim();
            el.setAttribute('censor-exclusion', existing ? `${existing} ${reason}` : reason);
        }
    }

    private setImgExcluded(el: HTMLImageElement, reason?: string) {
        el.setAttribute('censor-state', 'excluded');
        if (reason) {
            const existing = (el.getAttribute('censor-exclusion') ?? '').replace(reason, '').trim();
            el.setAttribute('censor-exclusion', existing ? `${existing} ${reason}` : reason);
        }
    }
}


const handleCensorResult = (request: any, port: browser.Runtime.Port, cache: ImageTracker) => {
    //TODO: this doesn't need to be separated. Just check the tag name on the element returned by the selector
    if(request.msg === "setSrc") {
        if (request.error) {
            console.log('BP - Error response from censoring request!', request.error, request.id);
        }
		const requestElement = document.querySelector(`[censor-id="${request.id}"]`)
		if(requestElement){
            if (requestElement.tagName === "IMG") {
                if (request.error) {
                    console.log('BP - Error response from censoring request!', request.error, request.id);
                }
                requestElement.setAttribute('src', request.censorURL);
                requestElement.removeAttribute('srcset');
                requestElement.setAttribute('censor-state', 'censored');
                requestElement.toggleAttribute('censor-placeholder', false);
                
            } else {
                (requestElement as HTMLElement).style.backgroundImage = "url('" + request.censorURL + "')";
                requestElement.setAttribute('censor-style', 'censored');
                requestElement.toggleAttribute('censor-placeholder', false);
            }
            cache.updateImage(request.id, request.censorURL);
		} else {
            dbgLog('failed to locate censoring target element by ID', request.id);
        }
        port.disconnect();
    }
}

function toDataURL(src: string, outputFormat?: string) {
    return new Promise<string>((resolve, reject) => {
        // const timeout = setTimeout(() => {
        //     reject('timeout while reading image data');
        // }, 2500);
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.addEventListener('error', function (e) {
            e.preventDefault(); // Prevent error from getting thrown
            reject(e);
        });
        img.onload = function () {
            try {
                const canvas = document.createElement('CANVAS') as HTMLCanvasElement;
                const ctx = canvas.getContext('2d');
                canvas.height = img.naturalHeight;
                canvas.width = img.naturalWidth;
                ctx?.drawImage(img, 0, 0);
                const dataURL = canvas.toDataURL(outputFormat);
                // clearTimeout(timeout);
                resolve(dataURL);
            } catch (e) {
                reject(e);
            }
        };
        img.src = src;
        //this is for cache busting to force load(), but doesn't seem entirely necessary
        // if (img.complete || img.complete === undefined) {
        //   img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
        //   img.src = src;
        // }
    });
}