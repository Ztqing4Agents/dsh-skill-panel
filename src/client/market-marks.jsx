/**
 * The market card's marks: the two sources' own brand images, and the three glyphs the
 * card's figures are drawn with.
 *
 * The two images are bitmaps on purpose: the user asked for the sources' own icons, and a
 * hand-traced single-colour path would be a lookalike rather than the mark. They travel as
 * data URIs so the browser half still makes no request of any kind (AGENTS.md rule 13) and
 * the bundle needs no asset loader.
 *
 * Both are 32x32 PNG at 1:1 for a 16px box (2x for a retina display); see
 * docs/contracts/decisions.md appendix J for where they came from and how to re-derive them.
 *
 * The three glyphs are drawn here rather than taken from the primitives because the
 * primitives ship no star and no bookmark (only a "like" pair), and a single-colour path
 * keeps their weight consistent with each other. Their size is the stylesheet's business
 * (`.skc_marketStat > svg`), so no component here carries a width, a height or a colour:
 * the stroke and fill are always `currentColor`.
 */
import { cn } from './styles.js';

/** SkillHub: the site's own 32x32 favicon (1334 B, sha256 b00f1749...25a0fc). */
const SKILLHUB_MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAABLFJREFUeAHNV21MW1UYfm7bMT5auARQOmYoOpDpEihOg0agyNAI0WFMZL9kZj80mQZITEyMGcX4Q+MfFv3hHxxLTNwWjTgWlxgRBllcnEDNFB1zWXGTkjCgg1IYH72+772jcO/t7ce2ZHuS2/PZ8zznPec95z3APYYQq4M02yfCgiZIoVLcLiTpBkLmfiGzujtuATKxGW2Ua8HdgxcmwS1Yq49GFUDkDpilPso6Ri6KGKbPlrYKZ5EfhQ8FcMcQSIStut1YwNzPV5i8s8eBzpMFqjZ71hK6Dp2HLXUVcWN1BggOKenWR4C03bwsrUJGTYdFRz7f10aNjkDQoiNn+KaTMUmfLTVOSzDp1BfA2qxSDv4GrEwA4sttZOkuk+4PkrSfEzZ7JFhp5kbLME+iT/Rux8BItpyXsfjnBvk6AoNAaFGEKdSisgApctGvg/MDnhwkikFPNjqOFYbLzkf9OFAxgLK8CJ1vXgaSd+01c97VIIn2EvebE9dT9qWnrRQHFi346nQ+ONViecWEMhrYnr2ka/voyE7MzCWFy7xU1iQfynf8ohew/C993mShfJ/kECTIOx5xgpehpfES6p6ZlMts7i97CnD8p+1y2S76UPjgReRS2lj+NZUnDMdiAV0koMmoQ9ljwNg4LduCvo09wZqyKluKRezIHcMnje9GJdTCROT5Ro1OIv/8EFBftVFn37Q1mJS9Yn3DJUouC5AknDFqvEQz7/yGNuR5pVxB7vvtZ0Dlbn1fp2NIR+75Owj/3BqiCjh3QnBTejhSI5v9+GmeqVL+Z1wRw8K0mPTbdXXf9/rhfHUUr7x9GZ6/WIz+8AqfhLwZn9015T57IUe1H157EWihmuFRUnk0MjnDmjyPH9+r1tV3fTcNMd2MhhoRrR9fhffaMkp3pmLvcxlyGj6Izh0TvJ++c8Fr1Ryxg3RwjYwqSgNBGCKwZIPPv01V100WEOiPTM5oO7gN+XlJmCVLiOnKvlE5+vCYiEBQ7fu+KeDgh4gJtoAWos2MN973oupJKxx5W/mUhZNm3dSQFe6jYus8+TASRV1JD+pKT6GQXNCmEeF6yobm1x9AQe0fKC1Ohfe/m3J5M1S34dON8hXsQgLkHzS0x+zHnsAewSJ4P2yG9qz1IwHU08zjAZOyNSJBdRs6i2Z+RwKYX7LhTqGyx689L7gocfmmUyJeRFpML2TFbQUjqPaAdKPXTX7TxnmOB/he52uZbzUj1JX2oL7kVNgalcX9iIkt5K4mGnN1ViNgrnc/aTqi7f98c4XOPY3A90FFNBE5bylh2S2oI6K1kFfbn4njJWcMjT9h3GitUJFDgkczssVDtewJ4Xhs7KrVcLxmigkqndfl5VKi50z4Zu2G/ZHyuKZCOqMSQA8HP+2Dw+v7gFFE8R8fz1or5FJ03Ljnmpyvp8Ck/lZwwuuKycj8FAdqyqYOfVBKlWQa73qRyQ+8dEXXLUyohSUTSK9FTEhSO03Ya/wwMdGpKGyEaRx4/HA2V85zsMlxYVQs0C22RiG5kKKI2pKnpOvkGTVuzkZ7mrEIckvjcC1hsGVDoVYhc0/4jRjP49RB6+KiI6sKtwsJ9DgNdQuZtf243/A/yy/GJ/+PpQkAAAAASUVORK5CYII=';

/** ClawHub: the site's own 192x192 logo, downscaled to 32x32 (2357 B, sha256 64a32b4f...949600). */
const CLAWHUB_MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAIn0lEQVRYCcVXS2xcVxn+zr0zdx62Z2yPnXH8SJz04YQ2LeAkbVpKoiA1KlK7aJHaBWJBd7BinQ0sWCCWIFViwYIlD5GgLgqtUGiJ2jTNo40b0rrxI34mtsfjed6Ze+85fP+9M+NHQeoKjvzPOfec//06x8D/eaj/Jn98aHzc9SvjQVMnBScWa2HadoekvQo6O3sWQQDbcdx4KjXLMb/nNPz8kgK5XO5E4HnnYXCGh9mISMG2LViWBaVUC+RkL7mB1gbGyKzDmV+Ct0W6S3E78fPVjdWrEc/odxeHTCbzmvaC35CoR5j4NC1JM5MO4AY2NCwk4lREWR0eopAMwRdwPY2YpZGKBXAbQD1QiJGHbQmeKjtO/PW1QuEPIZHstBfZbHay6Tb+we8uw+10TOPVJywcGtJ4Z6qJA90W5poJvD9vw6EnbIJY12YQBFTYaDxz2OCA42K2FODcRBz3SzZ+d9Og3BDFQRNUOZlIn14rrt0Q2e0wKhvWG3TbMXFYUmn84ICPn+UV3l7WKK9Z+MbRLM54FUwcsnB5iRbT1eJdsTqguzVpzj+lcNqrw/R3YWneR8oz+Gm/QVP7uFkEGhF+Qhs/3/S834sCoS97e3sP+oF/VpiRIyYtH/kZg8VFHzMFH8+MGbz2bB9ueClMFBv4ydMBmTLOxBVoUoHzT8cw8sDFjaaD75/txXP7NVYLAeYXAwx8YXBK+WBihLkR+MHZ4eHhsY4Cvu8fpORuyeYREyBR11jwgJm6AcOP/SPcZ0APD2Txy3mN000Pzz8BeFpROPBdhupIuY5fzHt4aDiDgxWGYZihIu1U1eA2eSnyHNUBArotMCZTLpcps+UBmcV48WmeqXafq3murxSpAH10nEzU21vIJDTWmVS/ntZ4ZaSJrh6FbsIL+5r41UwTFVuhR4r2UgknKVAzQS8XDD4nr1luD5I3l3Syhlevx7kVhUAWMsJSp0CGGCsEl1475SrULmncfRDg8/UCE8nGu1WFe3TRI/s0Hh6km1c8XHNjLFMbs6ubmF3zUHpP4yRd2qD1D8hrlSAZF7UTVkYyGZrcbi9yLOFnDQCpJt3PpV0CNkvM4CT7QG8THy352Kg5SKU1Prhn8PWRWpiEN1Y0nLiNjbqF6/c9ZKhYI67w8arBx+QzR8gRNG02komsnVirs+1SwKeH/G6FPsa+4EZK+CydxoBBl+dj2rVY0xovPhbHkXwen/5pCWwLOPViHrn1It68pTFdV8hUfVT6FT6jG5coT4T0MSGaKUXX0xjFknUpgCOsAlmEelHY7KaF/LhCjlQHuM8QM3GAIi2a27IxkQtQKQDH9jn4Fs++zThP5BwUl4EjAwzTpo0tRzH+huXMBCZtH3kNkec9esji/s4RecBnsKmCNIrNmoUp1v3xQxpT0wb0Jn5INyyNWWiUAyzQ9WsLdczcnsU5Cme/wl9/u4AKOVRp4XceDXCWBZZbUXiDpVrl/uNjCtcLFoq0PlJgW4lIAYkHS8tQAbZ8LG7YeHgAGGMtX1sxuMhY2u9opNNAqU5LyZQyQuukkx2mIlkm0B2G7qE1g1vzCvUyZ54dI58iz5fJM25Lu+am9M9dOSAOkBHGAXCoz5U5Cy+fZAjYHf42CyTIcJTCmZ9YJ2wQGIlwzJHrIlfhGWv4EzKqUbNn2T+6BhX+MkXhYmrLcOrTScJODkSsiENminEK2GT+eMVCNWnhxy8xJJMKBWZxhoiS2TcJjBBuE/7J9R2CZHqZfWDyqMKPnmf5dlm4eCvGts0blGftEXkh+hK9ojQV9VtDEHjXSFbg/S8UvuZ46OdZmlb1cT7AD3eIWR5jVpO14Q14gmHyNkmTAIap6BJd8uEcCQyvH3KSli3GRRfYtjqRB8IkbIuPZlFC0NyGwr8Ci6GgO1laJW6usj88WQZezjBMhMe5XibIWZx9pJu5Ms2uWOMNKO4mK47oVybphG5F0jayHVENRFdriNbCFQXiZHT1rsKTzzGhBoHr5JihtVc3DfZ7AWpEulYzGKMvm3ngm30K5ZzCh+9acCRDZYTWR8vol0SShDQ8CkHrrG11O2B804SlWWP9vsUmk3YM7hYUjmQMiqyvLha6IlGZHqnw7XSnqOAyBKVPAKGRhiM8W/bs0GB7Z5cCOzDCeEnqCCqdgNuLfIDQdRKYfQzFMJ8tC0M0gq1wzGGr4v1QIHwwI7VO68k5FCPWt1Ro58BOOf9RgagSKDV0SaSEhMLTFvq7eUMyH9aX6Gq6nr0FK0zgJBtDX0Vhi8BroS2ypQRFCi8ZMpGmPb6kwHaWRqs2odCNJgy+163xAq18b5hNh/GWMDXXFc4wT0b5fLvAhF1m4krHCy0WwtALbZHyLeGXW6Z1F1AL+jBSLlI5pAl3hImUUI6vmUyTV++ywZsWvUCKox8ZPHYt6p5vse0u3DUYaATIMVR8IoYKCFfRIZzbXqDoVCzGi7pVBbyb55XnVRhjOldcLhXBmZRSRvKKGaPQIsvlMony/N6/xGTjWgR9tsAw0IpFfueIM8qW+4DEdsijJT6aiCESVCmeTs+BN2LoBlqpEvH4BT/QL4UbIZaoEA2hzVLoU3RrlSBxn6b+PdwX18nF+iiv2zgRe3ihXCEUCW16Hre8ISt6zLb+3PC8V/ikl+snGtl0erLqNi5peiEk5clOFm0D2GcwnNXoTRrcl+7Jg0EK3/IsrLIM+RwMR4dxiMLN6I8dlv8bJBKna7Xarmc5n07eSiKZnNGBPkcaVnM02v94CEMBjzFZ58Nky1NI8Y0gfX6xQuFVC5JWbbyIWhIxWskvhZeSjvN6tV7/+/bunlUmnT6RcBIXY3ZsK2bZxlaWiVkCdgS2beJ2zPDcWIpgRWvZi/Osgye0LTqeFROOcyGbzh7fI25XmDpnkhN9fX0H+WziP6i+vHM7/8F0kL7iIh6LuT3J5Ozy5uY9iflXJPvfof0btqv2SrX7B3wAAAAASUVORK5CYII=';

/** The brand image of each source; a source added later simply has none. */
export const SOURCE_MARKS = Object.freeze({ skillhub: SKILLHUB_MARK, clawhub: CLAWHUB_MARK });

/**
 * The source's brand mark, 16x16, decoration only.
 *
 * `alt` is empty on purpose: the source is already announced once by the toolbar's source
 * menu, and twelve cards each reading "SkillHub" is noise. The visible `title` is the only
 * place the name appears, so a mouse user learns which image is which on first hover.
 * @param {{sourceId: string, label: string}} props - the item's source id and its localized name.
 * @returns {import('react').ReactElement|null} the image, or null for a source with no mark.
 */
export function SourceMark({ sourceId, label }) {
  const src = SOURCE_MARKS[sourceId];
  if (typeof src !== 'string') return null;
  return (
    <img
      className={cn('marketSourceMark')}
      src={src}
      alt=""
      title={label}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * The glyph of one figure slot: a download arrow, a bookmark, or a star.
 * @param {{slot: 'downloads'|'saves'|'rating'}} props - which slot this sits in.
 * @returns {import('react').ReactElement|null} the glyph, or null for an unknown slot.
 */
export function StatMark({ slot }) {
  if (slot === 'downloads') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2.5v7.2M8 9.7L4.9 6.6M8 9.7l3.1-3.1M2.8 13.2h10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (slot === 'saves') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4.5 2.5h7v11L8 10.6 4.5 13.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (slot === 'rating') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2.4l1.75 3.55 3.9.57-2.83 2.76.67 3.9L8 11.35l-3.49 1.83.67-3.9L2.35 6.52l3.9-.57z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return null;
}
